/**
 * SPEC-FIGMA-008 Phase 1.5 RED unit scaffold — tunnel revoke.
 *
 * REQ-07: revoke endpoint invalidates session immediately + 401 on subsequent
 * calls. SLA: ≤ 2000 ms revoke→audit row latency (AC-T7 oracle, asserted in
 * integration; this unit asserts the synchronous semantics).
 */

import { describe, it, expect } from "vitest";

import {
  TunnelSessionManager,
  type TunnelAdapter,
  type TunnelAttachResult,
} from "../../src/daemon/tunnel-session-manager.js";

class NoopAdapter implements TunnelAdapter {
  async attach(): Promise<TunnelAttachResult> {
    return {
      tunnelUrl: "https://noop.trycloudflare.com",
      tunnelSessionId: "ts_unit_revoke_01",
    };
  }
  async detach(): Promise<void> {}
}

describe("TunnelSessionManager.revoke (SPEC-FIGMA-008 unit)", () => {
  it("revoke invalidates session — subsequent calls return 401 tunnel_session_revoked", async () => {
    const m = new TunnelSessionManager({
      adapter: new NoopAdapter(),
      profileId: "claude-cowork-remote",
    });
    await m.confirmOptIn({ confirmed: true });
    const session = await m.attach({ ttlMs: 60_000 });

    await m.revoke({ tunnel_session_id: "ts_unit_revoke_01" });

    const r = await m.handleTunnelCall({
      bearer: session.bearer,
      tunnel_session_id: "ts_unit_revoke_01",
      mcp_method: "tools/call",
      tool_name: "x",
    });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("tunnel_session_revoked");
    expect(r.body.tunnel_session_id).toBe("ts_unit_revoke_01");
  });

  it("revoke is idempotent — calling twice does not throw", async () => {
    const m = new TunnelSessionManager({
      adapter: new NoopAdapter(),
      profileId: "claude-cowork-remote",
    });
    await m.confirmOptIn({ confirmed: true });
    await m.attach({ ttlMs: 60_000 });
    await m.revoke({ tunnel_session_id: "ts_unit_revoke_01" });
    await expect(m.revoke({ tunnel_session_id: "ts_unit_revoke_01" })).resolves.toBeUndefined();
  });

  it("revoke on unknown session_id returns silently (no throw, no state mutation)", async () => {
    const m = new TunnelSessionManager({
      adapter: new NoopAdapter(),
      profileId: "claude-cowork-remote",
    });
    await expect(m.revoke({ tunnel_session_id: "ts_does_not_exist" })).resolves.toBeUndefined();
  });
});
