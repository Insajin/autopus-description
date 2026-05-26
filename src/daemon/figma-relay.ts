// SPEC-FIGMA-017 Phase 2 — Node port of vendor/cursor-talk-to-figma-mcp/src/socket.ts.
//
// Hosts a channel-broadcast WebSocket relay on :3055 so the Autopus Figma plugin
// (rebranded fork of cursor_mcp_plugin) can connect using the original vendor
// protocol. The autopus daemon attaches as another peer in the same channel.
//
// Protocol (preserved byte-for-byte from vendor):
//   - Client sends {type:"join", channel, id} → server adds to channel set
//   - Client sends {type:"message", channel, message:{...}, id} → broadcast to
//     all OTHER clients in the same channel (sender excluded, prevents echo)
//   - Client sends {type:"progress_update", channel} → broadcast to peers
//
// All inbound `text` payloads from peers pass through `redact()` before any
// downstream handler logs/persists them (INV-W2 inherited).

import { WebSocketServer, WebSocket, type RawData } from "ws";
import { redact } from "../token-redactor.js";

export interface FigmaRelayOptions {
  /** Port to bind. Vendor uses 3055; pass another for parallel test runs. */
  readonly port?: number;
  /** Bind address. 127.0.0.1 by default; "0.0.0.0" only when explicitly opted in. */
  readonly host?: string;
}

export interface FigmaRelayStats {
  channels: number;
  clients: number;
}

interface ClientState {
  channel: string | null;
}

const VENDOR_PORT = 3055;
const DEFAULT_HOST = "127.0.0.1";

export class FigmaRelay {
  private readonly port: number;
  private readonly host: string;
  private wss: WebSocketServer | null = null;
  private readonly channels = new Map<string, Set<WebSocket>>();
  private readonly state = new WeakMap<WebSocket, ClientState>();

  constructor(opts: FigmaRelayOptions = {}) {
    this.port = opts.port ?? VENDOR_PORT;
    this.host = opts.host ?? DEFAULT_HOST;
  }

  /** Bind and start accepting connections. Resolves once `listening`. */
  async start(): Promise<void> {
    if (this.wss) return;
    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.port, host: this.host });
      wss.once("listening", () => {
        this.wss = wss;
        wss.on("connection", (ws) => this.handleConnection(ws));
        resolve();
      });
      wss.once("error", reject);
    });
  }

  /** Close all connections and the listening socket. Safe to call repeatedly. */
  async stop(): Promise<void> {
    if (!this.wss) return;
    const wss = this.wss;
    this.wss = null;
    await new Promise<void>((resolve) => {
      for (const ws of wss.clients) {
        try {
          ws.close();
        } catch {
          /* swallow */
        }
      }
      wss.close(() => resolve());
    });
    this.channels.clear();
  }

  /** Diagnostic snapshot for `get_daemon_status` and tests. */
  stats(): FigmaRelayStats {
    let clientCount = 0;
    for (const set of this.channels.values()) clientCount += set.size;
    return { channels: this.channels.size, clients: clientCount };
  }

  private handleConnection(ws: WebSocket): void {
    this.state.set(ws, { channel: null });
    this.send(ws, {
      type: "system",
      message: "Please join a channel to start chatting",
    });
    ws.on("message", (raw: RawData) => this.handleMessage(ws, raw));
    ws.on("close", () => this.handleClose(ws));
  }

  private handleMessage(ws: WebSocket, raw: RawData): void {
    let data: unknown;
    try {
      data = JSON.parse(raw.toString("utf8"));
    } catch {
      this.send(ws, { type: "error", message: "invalid JSON" });
      return;
    }
    if (!data || typeof data !== "object") {
      this.send(ws, { type: "error", message: "envelope must be object" });
      return;
    }
    const msg = data as Record<string, unknown>;
    const type = typeof msg.type === "string" ? msg.type : "";
    switch (type) {
      case "join":
        this.handleJoin(ws, msg);
        return;
      case "message":
        this.handleBroadcast(ws, msg);
        return;
      case "progress_update":
        this.handleProgress(ws, msg);
        return;
      default:
        this.send(ws, { type: "error", message: `unknown type: ${type}` });
    }
  }

  private handleJoin(ws: WebSocket, msg: Record<string, unknown>): void {
    const channel = typeof msg.channel === "string" ? msg.channel : "";
    if (!channel) {
      this.send(ws, { type: "error", message: "Channel name is required" });
      return;
    }
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(ws);
    const state = this.state.get(ws);
    if (state) state.channel = channel;
    this.send(ws, {
      type: "system",
      message: `Joined channel: ${channel}`,
      channel,
    });
    this.send(ws, {
      type: "system",
      message: { id: msg.id, result: `Connected to channel: ${channel}` },
      channel,
    });
    for (const peer of set) {
      if (peer === ws) continue;
      this.send(peer, {
        type: "system",
        message: "A new user has joined the channel",
        channel,
      });
    }
  }

  private handleBroadcast(ws: WebSocket, msg: Record<string, unknown>): void {
    const channel = typeof msg.channel === "string" ? msg.channel : "";
    if (!channel) {
      this.send(ws, { type: "error", message: "Channel name is required" });
      return;
    }
    const set = this.channels.get(channel);
    if (!set || !set.has(ws)) {
      this.send(ws, { type: "error", message: "You must join the channel first" });
      return;
    }
    for (const peer of set) {
      if (peer === ws) continue;
      if (peer.readyState !== WebSocket.OPEN) continue;
      this.send(peer, {
        type: "broadcast",
        message: msg.message,
        sender: "peer",
        channel,
      });
    }
  }

  private handleProgress(ws: WebSocket, msg: Record<string, unknown>): void {
    const channel = typeof msg.channel === "string" ? msg.channel : "";
    if (!channel) return;
    const set = this.channels.get(channel);
    if (!set || !set.has(ws)) return;
    for (const peer of set) {
      if (peer === ws) continue;
      if (peer.readyState !== WebSocket.OPEN) continue;
      this.send(peer, msg);
    }
  }

  private handleClose(ws: WebSocket): void {
    const state = this.state.get(ws);
    if (!state || !state.channel) return;
    const set = this.channels.get(state.channel);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.channels.delete(state.channel);
      return;
    }
    for (const peer of set) {
      if (peer.readyState !== WebSocket.OPEN) continue;
      this.send(peer, {
        type: "system",
        message: "A user has left the channel",
        channel: state.channel,
      });
    }
  }

  // @AX:WARN: [AUTO] redaction chokepoint — every outbound payload that leaves
  // this relay passes through `redact()` so figd_*/Authorization/private path
  // tokens never reach a peer. Removing this bypasses INV-W2.
  // @AX:REASON: SPEC-FIGMA-009 INV-W2 — broadcast surface treated as wire.
  private send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const text = redact(JSON.stringify(payload));
    try {
      ws.send(text);
    } catch {
      /* swallow — peer disconnect race */
    }
  }
}
