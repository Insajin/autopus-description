// SPEC-FIGMA-008 REQ-06, REQ-08, REQ-12 — Tunnel audit row emitter.
// Writes 6/7-key rows directly to audit.jsonl (NOT the 16-key EmittedAudit
// shape — AC-T2 / AC-T9 set-equality oracles require lean tunnel rows).
// Every byte passes through `redact` (figd_) and `redactTunnelUrl`
// (trycloudflare URLs) before persistence — INV-T7 zero-leak invariant.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { redact, redactTunnelUrl } from "../token-redactor.js";

export interface TunnelAttachedRow {
  readonly tunnel_session_id: string;
  readonly profile_id: string;
  readonly attached_at: string;
  readonly ttl_ms: number;
  readonly bearer_sha256: string;
}

export interface TunnelCallRow {
  readonly tunnel_session_id: string;
  readonly profile_id: string;
  readonly mcp_method: string;
  readonly resource_uri_or_tool_name: string;
  readonly ts: string;
}

export type TunnelTerminalEvent =
  | "tunnel_session_expired"
  | "tunnel_session_revoked"
  | "tunnel_session_closed_clean"
  | "tunnel_session_unauthorized";

export interface TunnelTerminalRow {
  readonly tunnel_session_id: string;
  readonly event: TunnelTerminalEvent;
  readonly ts?: string;
}

const VALID_TERMINAL_EVENTS: ReadonlySet<TunnelTerminalEvent> = new Set([
  "tunnel_session_expired",
  "tunnel_session_revoked",
  "tunnel_session_closed_clean",
  "tunnel_session_unauthorized",
]);

export interface TunnelAuditEmitterOptions {
  readonly auditPath: string;
}

export class TunnelAuditEmitter {
  private readonly auditPath: string;

  constructor(opts: TunnelAuditEmitterOptions) {
    this.auditPath = opts.auditPath;
  }

  emitAttached(row: TunnelAttachedRow): void {
    this.append({
      attached_at: row.attached_at,
      bearer_sha256: row.bearer_sha256,
      event: "tunnel_session_attached",
      profile_id: row.profile_id,
      ttl_ms: row.ttl_ms,
      tunnel_session_id: row.tunnel_session_id,
    });
  }

  emitCall(row: TunnelCallRow): void {
    this.append({
      event: "tunnel_call",
      mcp_method: row.mcp_method,
      profile_id: row.profile_id,
      resource_uri_or_tool_name: row.resource_uri_or_tool_name,
      ts: row.ts,
      tunnel_session_id: row.tunnel_session_id,
    });
  }

  // @AX:NOTE:[AUTO] — REQ-12 INV-T3 lifecycle terminal events are constrained to a fixed enum; appending arbitrary terminal strings would let upstream code emit silent ordering violations.
  emitTerminal(row: TunnelTerminalRow): void {
    if (!VALID_TERMINAL_EVENTS.has(row.event)) {
      throw new Error(`invalid tunnel terminal event: ${String(row.event)}`);
    }
    this.append({
      event: row.event,
      ts: row.ts ?? new Date().toISOString(),
      tunnel_session_id: row.tunnel_session_id,
    });
  }

  private append(row: Record<string, unknown>): void {
    const dir = dirname(this.auditPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // INV-T7 + SPEC-FIGMA-002 INV-005: redact figd_ AND trycloudflare URLs.
    const safe = redactTunnelUrl(redact(JSON.stringify(row)));
    appendFileSync(this.auditPath, safe + "\n", "utf8");
  }
}
