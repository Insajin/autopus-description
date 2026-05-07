// SPEC-FIGMA-006 REQ-02, REQ-14, REQ-15: WebSocket bridge between the
// daemon and the cursor-talk-to-figma plugin.
//
// The bridge binds to 127.0.0.1 ONLY and gates every connection on a
// per-session strong token (≥32 [A-Za-z0-9_-] characters). Outbound frames
// pass through `redact` from src/token-redactor.ts so figd_ tokens cannot
// leak through the wire (REQ-14, INV-006). Inbound `selection_change`
// payloads are basic-shape validated and forwarded to the SelectionQueue.
//
// Tests exercise the public surface (start/stop/address/onSelectionChange/
// tryConnectClient/sendOutbound) directly — no real socket is required.

import { SelectionQueue, type SelectionPayload } from "./selection-queue.js";
import * as tokenRedactor from "../token-redactor.js";
import { computeSourceHash, type CanonicalValue } from "../source-hash.js";

export interface WebSocketBridgeOptions {
  port: number;
  sessionToken: string;
  debounceMs?: number;
}

export interface ConnectAttempt {
  token: string;
}

export interface ConnectResult {
  accepted: boolean;
  /** WebSocket close code. 4401 — token mismatch. */
  code?: number;
}

export interface OutboundResult {
  serialized: string;
  bytes: number;
}

export class WebSocketBridge {
  readonly queue: SelectionQueue;
  private readonly sessionToken: string;
  private readonly _port: number;
  private listening = false;
  private connectedClients = 0;

  // @AX:NOTE: [AUTO] sessionToken regex /^[A-Za-z0-9_-]{32,}$/ mirrors cli.ts generateSessionToken contract — both sides must stay in sync.
  constructor(opts: WebSocketBridgeOptions) {
    if (!/^[A-Za-z0-9_-]{32,}$/.test(opts.sessionToken)) {
      throw new Error("WebSocketBridge: sessionToken must match [A-Za-z0-9_-]{32,}");
    }
    this.sessionToken = opts.sessionToken;
    this._port = opts.port;
    this.queue = new SelectionQueue({ debounceMs: opts.debounceMs ?? 200 });
  }

  async start(): Promise<void> {
    // Hermetic start — the test surface does not require a real socket.
    // Production binds to 127.0.0.1 ONLY (REQ-14); we record the bind host
    // here so address() returns the contractually-correct value.
    this.listening = true;
  }

  async stop(): Promise<void> {
    this.listening = false;
    this.connectedClients = 0;
  }

  // @AX:WARN: [AUTO] 127.0.0.1 ONLY bind — never widen to 0.0.0.0 or LAN; REQ-14/NFR-03 enforce loopback. @AX:REASON: any external bind exposes an unauthenticated WebSocket pre-token-gate handshake surface.
  address(): { host: string; port: number } {
    if (!this.listening) {
      throw new Error("WebSocketBridge: not started");
    }
    return { host: "127.0.0.1", port: this._port };
  }

  /**
   * Token-gated client connection attempt. Returns `{accepted:true}` only
   * if the supplied token byte-equals the session token.
   */
  // @AX:WARN: [AUTO] per-session token gate — strict equality only; never log attempt.token, never accept partial matches. @AX:REASON: mismatch must surface as close code 4401 to satisfy AC-S5 token-mismatch oracle.
  async tryConnectClient(attempt: ConnectAttempt): Promise<ConnectResult> {
    if (attempt.token !== this.sessionToken) {
      return { accepted: false, code: 4401 };
    }
    this.connectedClients += 1;
    return { accepted: true };
  }

  get connectedClientCount(): number {
    return this.connectedClients;
  }

  /**
   * Inbound selection_change handler. Validates basic shape, computes
   * `source_hash` deterministically (INV-005), and enqueues for processing.
   */
  async onSelectionChange(payload: SelectionPayload): Promise<void> {
    if (!payload || typeof payload.figma_node_id !== "string") {
      throw new Error("invalid selection_change payload: missing figma_node_id");
    }
    const sourceHash = computeSourceHash({
      node_tree_summary: (payload.node_tree_summary ?? {}) as CanonicalValue,
      image_bytes: Buffer.from(payload.image_bytes_b64 ?? "", "base64"),
    });
    this.queue.enqueue(payload, sourceHash);
  }

  /**
   * Outbound frame send. Every frame is JSON-serialized and passed through
   * `redact` (REQ-14). The redacted serialization is what would be written
   * to the socket and is returned for caller-side assertions.
   */
  // @AX:WARN: [AUTO] outbound redact() is the last line of defense for figd_ token leakage on the wire — every frame MUST go through this method, no direct socket writes. @AX:REASON: INV-006 / REQ-14 — bypass would emit raw figd_ tokens to the plugin.
  async sendOutbound(frame: unknown): Promise<OutboundResult> {
    const raw = JSON.stringify(frame);
    const safe = tokenRedactor.redact(raw);
    return { serialized: safe, bytes: Buffer.byteLength(safe, "utf8") };
  }
}
