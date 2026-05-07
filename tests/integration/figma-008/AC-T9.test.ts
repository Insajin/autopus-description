/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T9.
 *
 * REQ-06, REQ-08, REQ-12, NFR-03; INV-T2 + INV-T3 + INV-T7.
 *
 * 5 tool calls + 3 resource reads = 8 tunnel_call rows. 1 attach + 1 closed_clean.
 * Zero leaked figd_/trycloudflare URL substrings in any audit row.
 *
 * [NEW] surfaces:
 *   - manager.closeClean({tunnel_session_id}) → tunnel_session_closed_clean row
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
import {
  TunnelSessionManager,
  type TunnelAdapter,
  type TunnelAttachResult,
} from "../../../src/daemon/tunnel-session-manager.js";

class LeakMockAdapter implements TunnelAdapter {
  async attach(): Promise<TunnelAttachResult> {
    return {
      tunnelUrl: "https://audit-leak-test.trycloudflare.com",
    };
  }
  async detach(): Promise<void> {}
}

const TUNNEL_CALL_KEYS = [
  "event",
  "mcp_method",
  "profile_id",
  "resource_uri_or_tool_name",
  "ts",
  "tunnel_session_id",
];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t9-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T9 audit-per-call coverage + zero leaked URL", () => {
  it("Test_TunnelSession_5Tools3Resources_Emits8TunnelCallRowsWithNoUrlLeak", async () => {
    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    const manager = new TunnelSessionManager({
      adapter: new LeakMockAdapter(),
      profileId: "claude-cowork-remote",
      stdout: process.stdout,
    });
    await manager.confirmOptIn({ confirmed: true });
    const session = await manager.attach({ ttlMs: 8 * 60 * 60 * 1000 });
    const tid = session.tunnel_session_id;

    // 5 distinct tool calls.
    for (let i = 0; i < 5; i++) {
      await manager.handleTunnelCall({
        bearer: session.bearer,
        tunnel_session_id: tid,
        mcp_method: "tools/call",
        tool_name: `tool_${i}`,
      });
    }
    // 3 distinct resource reads.
    for (let i = 0; i < 3; i++) {
      await manager.handleTunnelCall({
        bearer: session.bearer,
        tunnel_session_id: tid,
        mcp_method: "resources/read",
        resource_uri: `figma://frame_${i}`,
      });
    }
    await manager.closeClean({ tunnel_session_id: tid });

    const rows = readFileSync(join(workDir, ".autopus", "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const attached = rows.filter(
      (r) => r.event === "tunnel_session_attached" && r.tunnel_session_id === tid,
    );
    expect(attached).toHaveLength(1);

    const calls = rows.filter(
      (r) => r.event === "tunnel_call" && r.tunnel_session_id === tid,
    );
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      // Set equality on tunnel_call key set.
      const keys = Object.keys(c).filter((k) =>
        TUNNEL_CALL_KEYS.includes(k),
      ).sort();
      expect(keys).toEqual(TUNNEL_CALL_KEYS);
    }

    const closed = rows.filter(
      (r) => r.event === "tunnel_session_closed_clean" && r.tunnel_session_id === tid,
    );
    expect(closed).toHaveLength(1);

    // INV-T7: zero leaked URL or figd_ in serialized JSON.
    const serialized = rows.map((r) => JSON.stringify(r)).join("\n");
    expect(serialized).not.toMatch(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    expect(serialized).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);

    // INV-T3 temporal ordering on this session_id.
    const lifecycle = rows
      .filter((r) => r.tunnel_session_id === tid)
      .map((r) => ({ event: r.event, ts: String(r.ts) }));
    const attachIdx = lifecycle.findIndex((r) => r.event === "tunnel_session_attached");
    const closedIdx = lifecycle.findIndex((r) => r.event === "tunnel_session_closed_clean");
    const callIndices = lifecycle
      .map((r, i) => (r.event === "tunnel_call" ? i : -1))
      .filter((i) => i >= 0);
    for (const i of callIndices) {
      expect(i).toBeGreaterThan(attachIdx);
      expect(i).toBeLessThan(closedIdx);
    }

    await daemon.shutdown();
  });
});
