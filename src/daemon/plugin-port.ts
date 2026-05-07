// SPEC-FIGMA-008 — Plugin port interface + in-memory port impl.
//
// PluginPort is the daemon-facing abstraction over the Figma plugin's
// WebSocket bridge. The tunnel session manager calls setStripState() to
// surface tunnel state to the user; sendToClient() pushes server→plugin
// messages; onMessage() registers a plugin→server handler.
//
// InMemoryPluginPort is the dev/integration test port (no real WS).
//
// Test fakes (PluginStatusStripPort, PluginStorageMock) are re-exported
// from plugin-port-mocks for backward compatibility with the Phase 1.5
// test scaffolds that imported them by name from this directory.

import type {
  PluginStatusStripPortLike,
  PluginStorageLike,
} from "./tunnel-session-types.js";

export type PluginMessage = { type: string; [k: string]: unknown };

export interface PluginPort {
  setStripState(state: string): void;
  getStripState(): string;
  sendToClient(msg: PluginMessage): void;
  onMessage(handler: (msg: PluginMessage) => void): () => void;
  close(): void;
}

export class InMemoryPluginPort implements PluginPort, PluginStatusStripPortLike {
  private state = "tunnel: off";
  private outbound: PluginMessage[] = [];
  private handlers: Array<(msg: PluginMessage) => void> = [];
  private closed = false;

  setStripState(state: string): void { this.state = state; }
  getStripState(): string { return this.state; }
  // PluginStatusStripPortLike adapters so InMemoryPluginPort can plug into
  // TunnelSessionManager.statusStrip directly (REQ-11 oracle).
  set(state: string): void { this.setStripState(state); }
  current(): string { return this.getStripState(); }

  sendToClient(msg: PluginMessage): void {
    if (this.closed) return;
    this.outbound.push(msg);
  }
  onMessage(handler: (msg: PluginMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }
  /** Test helper — simulate a plugin→server message. */
  injectFromClient(msg: PluginMessage): void {
    if (this.closed) return;
    for (const h of this.handlers) h(msg);
  }
  /** Test helper — capture outbound messages. */
  drainOutbound(): PluginMessage[] {
    const out = this.outbound;
    this.outbound = [];
    return out;
  }
  close(): void { this.closed = true; this.handlers = []; }
}

class InMemoryClientStorage {
  private readonly store = new Map<string, string>();
  async setAsync(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async getAsync(key: string): Promise<string | undefined> { return this.store.get(key); }
  async deleteAsync(key: string): Promise<void> { this.store.delete(key); }
}

export class PluginStatusStripPort implements PluginStatusStripPortLike {
  private state = "tunnel: off";
  set(state: string): void { this.state = state; }
  current(): string { return this.state; }
}

export class PluginStorageMock implements PluginStorageLike {
  readonly pluginData = new Map<string, string>();
  readonly clientStorage = new InMemoryClientStorage();
}
