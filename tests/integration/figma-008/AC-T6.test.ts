/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T6.
 *
 * REQ-04, REQ-15, INV-T3 lifecycle ordering.
 * TTL=5000 ms, advance fixed clock by +5001 ms, post-expiry MCP call → 401
 * with body {error:"tunnel_session_expired",tunnel_session_id} and audit row.
 *
 * [NEW] surfaces:
 *   - TunnelSessionManager.attach({ttlMs, clock})
 *   - TunnelSessionManager.handleTunnelCall(req): {status, body}
 *   - manager.advanceClock(ms) for hermetic time
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
import {
  TunnelSessionManager,
  type TunnelAdapter,
  type TunnelAttachResult,
} from "../../../src/daemon/tunnel-session-manager.js";

class FastMockAdapter implements TunnelAdapter {
  async attach(): Promise<TunnelAttachResult> {
    return { tunnelUrl: "https://expiry-mock.trycloudflare.com" };
  }
  async detach(): Promise<void> {}
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t6-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T6 TTL expiry rejects in-flight call with 401 + audit row", () => {
  it("Test_Tunnel_TtlExpired_Rejects401AndEmitsExpiredAuditRow", async () => {
    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    const manager = new TunnelSessionManager({
      adapter: new FastMockAdapter(),
      profileId: "claude-cowork-remote",
      stdout: process.stdout,
    });
    await manager.confirmOptIn({ confirmed: true });

    // Hermetic fake clock starting at t=0.
    let now = 0;
    manager.setClock(() => now);

    const session = await manager.attach({ ttlMs: 5000 });
    const tid = session.tunnel_session_id;

    // Advance clock by exactly +5001 ms — past TTL.
    now = 5001;

    const result = await manager.handleTunnelCall({
      bearer: session.bearer,
      tunnel_session_id: tid,
      mcp_method: "tools/call",
      tool_name: "figma.read",
    });

    expect(result.status).toBe(401);
    expect(Object.keys(result.body).sort()).toEqual([
      "error",
      "tunnel_session_id",
    ]);
    expect(result.body.error).toBe("tunnel_session_expired");
    expect(result.body.tunnel_session_id).toBe(tid);

    const auditPath = join(workDir, ".autopus", "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const rows = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const expired = rows.filter(
      (r) => r.event === "tunnel_session_expired" && r.tunnel_session_id === tid,
    );
    expect(expired).toHaveLength(1);

    // INV-T3 ordering: attached → (zero+ tunnel_call) → expired (terminal).
    const lifecycle = rows.filter(
      (r) => r.tunnel_session_id === tid &&
        ["tunnel_session_attached", "tunnel_call", "tunnel_session_expired"].includes(r.event),
    );
    expect(lifecycle[0].event).toBe("tunnel_session_attached");
    expect(lifecycle[lifecycle.length - 1].event).toBe("tunnel_session_expired");

    // No tunnel_call after the terminal row.
    const expiredTs = lifecycle[lifecycle.length - 1].ts;
    const callsAfter = lifecycle.filter(
      (r) => r.event === "tunnel_call" && String(r.ts) > String(expiredTs),
    );
    expect(callsAfter).toHaveLength(0);

    await daemon.shutdown();
  });
});
