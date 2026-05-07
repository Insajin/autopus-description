// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-02, REQ-14, REQ-15, AC-S1, AC-S2, AC-S5.
// Asserts WebSocket bridge bind to 127.0.0.1, per-session token gate, and FIFO ordering.

import { describe, it, expect } from "vitest";

import { WebSocketBridge } from "../../src/daemon/bridge.js";

describe("WebSocket bridge isolation (REQ-14, AC-S5)", () => {
  it("binds to 127.0.0.1 only by default — listening address equals 127.0.0.1", async () => {
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "x".repeat(32) });
    await bridge.start();
    const addr = bridge.address();
    expect(addr.host).toBe("127.0.0.1");
    await bridge.stop();
  });

  it("rejects WebSocket connection that does not present the session token", async () => {
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "secret-token-1234567890123456789012" });
    await bridge.start();
    const result = await bridge.tryConnectClient({ token: "wrong-token" });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe(4401);
    await bridge.stop();
  });

  it("accepts connection presenting the matching session token", async () => {
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "secret-token-1234567890123456789012" });
    await bridge.start();
    const result = await bridge.tryConnectClient({ token: "secret-token-1234567890123456789012" });
    expect(result.accepted).toBe(true);
    await bridge.stop();
  });
});

describe("Selection event FIFO + debounce (REQ-02, REQ-15, AC-S2)", () => {
  it("appends 1 event after onSelectionChange — queue.size === 1", async () => {
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "t".repeat(32) });
    await bridge.start();
    await bridge.onSelectionChange({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: { a: 1, b: 2 },
      image_bytes_b64_sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      image_bytes_b64: "YWJj",
    });
    expect(bridge.queue.size).toBe(1);
    const peek = bridge.queue.peek();
    expect(peek).toBeDefined();
    expect(peek!.frame_id).toBe("1:1");
    await bridge.stop();
  });

  it("preserves FIFO ordering across distinct frame_id values (INV-001)", async () => {
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "t".repeat(32) });
    await bridge.start();
    for (const fid of ["A", "B", "C", "D"]) {
      await bridge.onSelectionChange({ figma_node_id: fid, screen_id: "S", node_tree_summary: {}, image_bytes_b64_sha256: "0".repeat(64), image_bytes_b64: "" });
    }
    expect(bridge.queue.toArray().map((e: { frame_id: string }) => e.frame_id)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    await bridge.stop();
  });
});
