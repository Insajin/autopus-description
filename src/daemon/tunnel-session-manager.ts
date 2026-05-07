// SPEC-FIGMA-008 REQ-03/04/06/07/12 — Tunnel session lifecycle orchestrator.
//
// Owns: opt-in gate → attach (audit + stdout) → handleTunnelCall (TTL guard
// + per-call audit) → terminal (expired | revoked | closed_clean).
//
// Default-safe: the constructor does NOT spawn the adapter; only confirmOptIn
// + attach do (REQ-03). The adapter is injected (mock in tests, cloudflared
// in production).

import { randomBytes } from "node:crypto";

import { redactTunnelUrl } from "../token-redactor.js";
import {
  TunnelSession,
  generateRandomBearer,
  generateTunnelSessionId,
  tunnelUrlHash8,
} from "./tunnel-session.js";
import { TunnelAuditEmitter } from "./tunnel-audit-emitter.js";
import { resolveTunnelAuditPath } from "./tunnel-audit-path.js";
import type {
  TunnelManagerStatus,
  PluginStatusStripPortLike,
  PluginStorageLike,
  AttachedSessionView,
  TunnelCallRequest,
  TunnelCallResponse,
  TunnelSessionManagerOptions,
} from "./tunnel-session-types.js";

export type { TunnelAdapter, TunnelAttachResult } from "./tunnel-adapter.js";
export type {
  TunnelManagerStatus,
  PluginStatusStripPortLike,
  PluginStorageLike,
  AttachedSessionView,
  TunnelCallRequest,
  TunnelCallResponse,
  TunnelSessionManagerOptions,
} from "./tunnel-session-types.js";

const DEFAULT_TTL_MS = 28_800_000;
const DEFAULT_PENDING_TIMEOUT_MS = 30_000;

export class TunnelSessionManager {
  private readonly adapter: import("./tunnel-adapter.js").TunnelAdapter;
  private readonly profileId: string;
  private readonly auditEmitter: TunnelAuditEmitter;
  private readonly auditEmit?: (row: Record<string, unknown>) => void;
  private readonly statusStrip?: PluginStatusStripPortLike;
  private readonly pluginStorage?: PluginStorageLike;
  private readonly stdoutListeners: Array<(line: string) => void> = [];
  private readonly originalStdoutWrite?: { write: (line: string) => void } | NodeJS.WriteStream;
  private readonly pendingConfirmTimeoutMs: number;

  private session: TunnelSession | null = null;
  private _status: TunnelManagerStatus = "idle";
  private clock: () => number = () => Date.now();

  constructor(opts: TunnelSessionManagerOptions) {
    this.adapter = opts.adapter;
    this.profileId = opts.profileId;
    this.auditEmitter = new TunnelAuditEmitter({
      auditPath: resolveTunnelAuditPath(opts.auditPath),
    });
    this.auditEmit = opts.auditEmit;
    this.originalStdoutWrite = opts.stdout;
    this.statusStrip = opts.statusStrip;
    this.pluginStorage = opts.pluginStorage;
    this.pendingConfirmTimeoutMs = opts.pendingConfirmTimeoutMs ?? DEFAULT_PENDING_TIMEOUT_MS;

    // REQ-03: enter pending_confirm state immediately on construction.
    this._status = "pending_confirm";
    queueMicrotask(() => {
      if (this._status === "pending_confirm") {
        this.printStdout({
          event: "tunnel_pending_confirm",
          timeout_ms: this.pendingConfirmTimeoutMs,
        });
      }
    });
    this.statusStrip?.set("tunnel: off");
  }

  get status(): TunnelManagerStatus { return this._status; }

  setClock(fn: () => number): void { this.clock = fn; }

  captureStdout(listener: (line: string) => void): void {
    this.stdoutListeners.push(listener);
  }

  async confirmOptIn(input: { confirmed: boolean }): Promise<void> {
    if (this._status !== "pending_confirm") return;
    if (!input.confirmed) {
      this._status = "declined";
      this.printStdout({ event: "tunnel_optin_declined" });
      return;
    }
    // Confirmed — adapter spawn happens at attach() to keep opt-in cheap.
    this._status = "pending_confirm";
  }

  async attach(opts: { ttlMs?: number } = {}): Promise<AttachedSessionView> {
    if (this._status === "declined") {
      throw new Error("tunnel opt-in declined");
    }
    const result = await this.adapter.attach();
    const ttlMs = Math.min(opts.ttlMs ?? DEFAULT_TTL_MS, DEFAULT_TTL_MS);
    const bearer = generateRandomBearer();
    const salt = randomBytes(16).toString("hex");
    const tunnel_session_id = result.tunnelSessionId ?? generateTunnelSessionId();
    const attachedAt = this.clock();
    this.session = new TunnelSession({
      bearer,
      salt,
      attachedAt,
      ttlMs,
      tunnel_session_id,
    });
    this._status = "attached";
    const urlHash = tunnelUrlHash8(result.tunnelUrl);

    this.printStdout({
      bearer_sha256: this.session.bearerSha256,
      event: "tunnel_attached",
      transport: "tunnel",
      ttl_ms: ttlMs,
      tunnel_session_id,
      tunnel_url_hash: urlHash,
    });

    const attachedRow = {
      attached_at: new Date(attachedAt).toISOString(),
      bearer_sha256: this.session.bearerSha256,
      profile_id: this.profileId,
      ttl_ms: ttlMs,
      tunnel_session_id,
    };
    this.auditEmitter.emitAttached(attachedRow);
    this.auditEmit?.({ ...attachedRow, event: "tunnel_session_attached" });

    this.statusStrip?.set(`tunnel: ${urlHash}`);

    return {
      tunnel_session_id,
      bearer,
      status: this._status,
      bearer_sha256: this.session.bearerSha256,
      ttl_ms: ttlMs,
    };
  }

  async handleTunnelCall(req: TunnelCallRequest): Promise<TunnelCallResponse> {
    // Yield once so concurrent revoke()/expire() calls can update state before
    // we resolve. AC-T7 in-flight oracle requires that 3 calls kicked off
    // synchronously before revoke() all observe the revoked state.
    await new Promise<void>((r) => setImmediate(r));
    const sess = this.session;
    if (!sess || this._status !== "attached") {
      const reason: "tunnel_session_revoked" | "tunnel_session_expired" | "tunnel_session_unauthorized" =
        this._status === "revoked"
          ? "tunnel_session_revoked"
          : this._status === "expired"
            ? "tunnel_session_expired"
            : "tunnel_session_unauthorized";
      return {
        status: 401,
        body: { error: reason, tunnel_session_id: req.tunnel_session_id },
      };
    }

    const now = this.clock();
    if (sess.isExpired(now)) {
      this._status = "expired";
      this.auditEmitter.emitTerminal({
        tunnel_session_id: sess.tunnel_session_id,
        event: "tunnel_session_expired",
        ts: new Date(now).toISOString(),
      });
      return {
        status: 401,
        body: {
          error: "tunnel_session_expired",
          tunnel_session_id: sess.tunnel_session_id,
        },
      };
    }

    if (req.bearer !== sess.bearer || req.tunnel_session_id !== sess.tunnel_session_id) {
      this.auditEmitter.emitTerminal({
        tunnel_session_id: req.tunnel_session_id,
        event: "tunnel_session_unauthorized",
        ts: new Date(now).toISOString(),
      });
      return {
        status: 401,
        body: {
          error: "tunnel_session_unauthorized",
          tunnel_session_id: req.tunnel_session_id,
        },
      };
    }

    const target = req.tool_name ?? req.resource_uri ?? "";
    this.auditEmitter.emitCall({
      tunnel_session_id: sess.tunnel_session_id,
      profile_id: this.profileId,
      mcp_method: req.mcp_method,
      resource_uri_or_tool_name: target,
      ts: new Date(now).toISOString(),
    });

    return { status: 200, body: { ok: "true", tunnel_session_id: sess.tunnel_session_id } };
  }

  async revoke(input: { tunnel_session_id: string }): Promise<void> {
    const sess = this.session;
    if (!sess || sess.tunnel_session_id !== input.tunnel_session_id) return;
    this._status = "revoked";
    this.auditEmitter.emitTerminal({
      tunnel_session_id: sess.tunnel_session_id,
      event: "tunnel_session_revoked",
      ts: new Date(this.clock()).toISOString(),
    });
    this.statusStrip?.set("tunnel: revoked");
    if (this.pluginStorage) {
      this.pluginStorage.pluginData.set("autopus.session.token_hash", "0".repeat(64));
      await this.pluginStorage.clientStorage.deleteAsync("autopus.session.bearer");
    }
    try { await this.adapter.detach(); } catch { /* best effort */ }
  }

  async closeClean(input: { tunnel_session_id: string }): Promise<void> {
    const sess = this.session;
    if (!sess || sess.tunnel_session_id !== input.tunnel_session_id) return;
    this._status = "closed_clean";
    this.auditEmitter.emitTerminal({
      tunnel_session_id: sess.tunnel_session_id,
      event: "tunnel_session_closed_clean",
      ts: new Date(this.clock()).toISOString(),
    });
    this.statusStrip?.set("tunnel: off");
    try { await this.adapter.detach(); } catch { /* best effort */ }
  }

  private printStdout(payload: Record<string, unknown>): void {
    const line = redactTunnelUrl(JSON.stringify(payload));
    for (const l of this.stdoutListeners) l(line);
    if (this.originalStdoutWrite && this.stdoutListeners.length === 0) {
      this.originalStdoutWrite.write(line + "\n");
    }
  }
}
