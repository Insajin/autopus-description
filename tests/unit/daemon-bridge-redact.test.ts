// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-14, AC-S8
// Outbound WebSocket frames pass through `redact` from src/token-redactor.ts.

import { describe, it, expect, vi } from "vitest";

import * as tokenRedactor from "../../src/token-redactor.js";
import { WebSocketBridge } from "../../src/daemon/bridge.js";

describe("Outbound frame redaction (REQ-14, AC-S8)", () => {
  it("invokes redact() at least once per outbound frame", async () => {
    const spy = vi.spyOn(tokenRedactor, "redact");
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "t".repeat(32) });
    await bridge.start();
    const fakeClient = await bridge.tryConnectClient({ token: "t".repeat(32) });
    expect(fakeClient.accepted).toBe(true);

    await bridge.sendOutbound({ event: "ping", figd: "figd_ABCDEFGHIJKLMNOP_should_be_redacted" });
    await bridge.sendOutbound({ event: "ping2" });
    await bridge.sendOutbound({ event: "ping3" });

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    await bridge.stop();
    spy.mockRestore();
  });

  it("persisted outbound payload contains zero figd_ matches", async () => {
    const bridge = new WebSocketBridge({ port: 0, sessionToken: "t".repeat(32) });
    await bridge.start();
    await bridge.tryConnectClient({ token: "t".repeat(32) });
    const sent = await bridge.sendOutbound({
      event: "selection",
      payload: "leak figd_ABCDEFGHIJKLMNOPQRSTUV here",
    });
    expect(sent.serialized).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
    await bridge.stop();
  });
});
