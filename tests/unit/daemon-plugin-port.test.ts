/**
 * SPEC-FIGMA-008 Phase 3 — coverage tests for src/daemon/plugin-port.ts.
 *
 * Targets uncovered lines 30-64 (InMemoryPluginPort full surface +
 * PluginStatusStripPort + PluginStorageMock).
 */

import { describe, it, expect } from "vitest";

import {
  InMemoryPluginPort,
  PluginStatusStripPort,
  PluginStorageMock,
  type PluginMessage,
} from "../../src/daemon/plugin-port.js";

describe("InMemoryPluginPort (SPEC-FIGMA-008)", () => {
  it("setStripState/getStripState round-trips state strings", () => {
    const p = new InMemoryPluginPort();
    expect(p.getStripState()).toBe("tunnel: off");
    p.setStripState("tunnel: a3f9c2e1");
    expect(p.getStripState()).toBe("tunnel: a3f9c2e1");
  });

  it("PluginStatusStripPortLike adapter (set/current) mirrors strip state", () => {
    const p = new InMemoryPluginPort();
    p.set("tunnel: revoked");
    expect(p.current()).toBe("tunnel: revoked");
    expect(p.getStripState()).toBe("tunnel: revoked");
  });

  it("sendToClient queues outbound messages, drainOutbound returns + clears queue", () => {
    const p = new InMemoryPluginPort();
    p.sendToClient({ type: "tunnel.advert", profile_id: "claude-code-local" });
    p.sendToClient({ type: "ping" });
    const drained = p.drainOutbound();
    expect(drained).toHaveLength(2);
    expect(drained[0].type).toBe("tunnel.advert");
    expect(p.drainOutbound()).toHaveLength(0);
  });

  it("onMessage registers handler and injectFromClient invokes it", () => {
    const p = new InMemoryPluginPort();
    const received: PluginMessage[] = [];
    p.onMessage((m) => received.push(m));
    p.injectFromClient({ type: "tunnel.confirm_optin", confirmed: true });
    expect(received).toHaveLength(1);
    expect(received[0].confirmed).toBe(true);
  });

  it("onMessage returns disposer that removes handler", () => {
    const p = new InMemoryPluginPort();
    const received: PluginMessage[] = [];
    const dispose = p.onMessage((m) => received.push(m));
    p.injectFromClient({ type: "a" });
    dispose();
    p.injectFromClient({ type: "b" });
    expect(received.map((m) => m.type)).toEqual(["a"]);
  });

  it("close() prevents further outbound queueing AND inbound dispatch", () => {
    const p = new InMemoryPluginPort();
    const received: PluginMessage[] = [];
    p.onMessage((m) => received.push(m));
    p.close();
    p.sendToClient({ type: "post-close" });
    p.injectFromClient({ type: "post-close-in" });
    expect(p.drainOutbound()).toHaveLength(0);
    expect(received).toHaveLength(0);
  });

  it("disposer is no-op for already-removed handler (idempotency)", () => {
    const p = new InMemoryPluginPort();
    const dispose = p.onMessage(() => {});
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe("PluginStatusStripPort (SPEC-FIGMA-008)", () => {
  it("default state is 'tunnel: off' and set updates it", () => {
    const s = new PluginStatusStripPort();
    expect(s.current()).toBe("tunnel: off");
    s.set("tunnel: 12345678");
    expect(s.current()).toBe("tunnel: 12345678");
  });
});

describe("PluginStorageMock (SPEC-FIGMA-008)", () => {
  it("pluginData Map round-trips strings", () => {
    const m = new PluginStorageMock();
    m.pluginData.set("k", "v");
    expect(m.pluginData.get("k")).toBe("v");
  });

  it("clientStorage setAsync/getAsync/deleteAsync surface the IndexedDB shape", async () => {
    const m = new PluginStorageMock();
    await m.clientStorage.setAsync("autopus.session.bearer", "bearer_AAA");
    expect(await m.clientStorage.getAsync("autopus.session.bearer")).toBe("bearer_AAA");
    await m.clientStorage.deleteAsync("autopus.session.bearer");
    expect(await m.clientStorage.getAsync("autopus.session.bearer")).toBeUndefined();
  });

  it("clientStorage.getAsync returns undefined for unknown keys", async () => {
    const m = new PluginStorageMock();
    expect(await m.clientStorage.getAsync("nonexistent")).toBeUndefined();
  });
});
