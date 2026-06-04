// SPEC-FIGMA-017 Phase 2 — autopus-side client for the Figma relay.
//
// Connects to the FigmaRelay on `ws://127.0.0.1:3055`, joins a channel, and
// forwards `sendCommand(name, params)` calls to the plugin running in Figma.
// Each call returns a Promise that resolves when the matching `id` response
// arrives on the channel broadcast.
//
// Protocol mirrors vendor (`vendor/cursor-talk-to-figma-mcp/src/talk_to_figma_mcp/server.ts`
// `sendCommandToFigma`). Differences: pure Node (`ws` lib), redaction reused
// from autopus token-redactor, no global state.

import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

import { redact } from "../token-redactor.js";

export interface FigmaPluginClientOptions {
  /** Relay URL, defaults to ws://127.0.0.1:3055. */
  readonly url?: string;
  /** Channel name to join. Required before sendCommand works. */
  readonly channel: string;
  /** Per-request timeout (ms). Default 30s mirrors vendor. */
  readonly timeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_URL = "ws://127.0.0.1:3055";
const DEFAULT_TIMEOUT = 30_000;

export class FigmaPluginClient {
  private readonly url: string;
  private readonly channel: string;
  private readonly timeoutMs: number;
  private ws: WebSocket | null = null;
  private joined = false;
  private readonly pending = new Map<string, PendingRequest>();
  // Auto-reconnect: once a first connect() succeeds, a dropped socket (idle
  // timeout, transient network) self-heals with capped backoff + re-join,
  // instead of leaving the daemon dead until a manual /mcp reconnect.
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private readonly maxReconnectDelay = 30_000;

  constructor(opts: FigmaPluginClientOptions) {
    this.url = opts.url ?? DEFAULT_URL;
    this.channel = opts.channel;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const onError = (err: Error): void => reject(err);
      ws.once("error", onError);
      ws.once("open", () => {
        ws.off("error", onError);
        this.ws = ws;
        ws.on("message", (data) => this.onMessage(data.toString("utf8")));
        ws.on("close", () => this.onClose());
        resolve();
      });
    });
    await this.join();
    // Connected + joined: arm auto-reconnect and reset backoff.
    this.shouldReconnect = true;
    this.reconnectDelay = 1_000;
  }

  async close(): Promise<void> {
    // Intentional shutdown — disarm auto-reconnect.
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.joined = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("client_closed"));
    }
    this.pending.clear();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* swallow */
      }
    }
  }

  /** Connected and joined to the channel. */
  isReady(): boolean {
    return this.joined && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send a command to the plugin and await the response. */
  async sendCommand(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("FigmaPluginClient not connected");
    }
    if (!this.joined) {
      throw new Error("FigmaPluginClient must join a channel first");
    }
    const id = randomUUID();
    const envelope = {
      id,
      type: "message",
      channel: this.channel,
      message: {
        id,
        command,
        params: { ...params, commandId: id },
      },
    };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`figma_command_timeout:${command}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(redact(JSON.stringify(envelope)));
    });
  }

  private async join(): Promise<void> {
    if (!this.ws) throw new Error("ws not initialized");
    const id = randomUUID();
    const payload = {
      id,
      type: "join",
      channel: this.channel,
      message: { id, command: "join", params: { channel: this.channel } },
    };
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("join_timeout"));
      }, this.timeoutMs);
      const onMsg = (data: Buffer | ArrayBuffer | string): void => {
        try {
          const parsed = JSON.parse(data.toString());
          // Server emits {type:"system", message: "Joined channel: X" } on
          // success — accept either string or object message body.
          if (parsed?.type === "system") {
            clearTimeout(timer);
            this.ws!.off("message", onMsg);
            this.joined = true;
            resolve();
          }
        } catch {
          /* ignore parse errors during join */
        }
      };
      this.ws!.on("message", onMsg);
      this.ws!.send(JSON.stringify(payload));
    });
  }

  private onMessage(text: string): void {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const env = data as Record<string, unknown>;
    if (env.type !== "broadcast" && env.type !== "system") return;
    const inner = env.message as Record<string, unknown> | undefined;
    if (!inner || typeof inner !== "object") return;
    const id = typeof inner.id === "string" ? inner.id : null;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if ("error" in inner && inner.error) {
      pending.reject(new Error(String(inner.error)));
      return;
    }
    if ("result" in inner) {
      pending.resolve(inner.result);
      return;
    }
    pending.resolve(inner);
  }

  private onClose(): void {
    this.joined = false;
    this.ws = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("plugin_disconnected"));
    }
    this.pending.clear();
    if (this.shouldReconnect) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    const t = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Connect failed (relay down / not yet rebound) — back off and retry.
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
        this.scheduleReconnect();
      });
    }, delay);
    // The reconnect timer must not keep the process alive on its own.
    t.unref?.();
    this.reconnectTimer = t;
  }
}
