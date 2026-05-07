/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T7.
 *
 * REQ-07, REQ-11: 1-click revoke from plugin.
 * 3 in-flight calls → 401 tunnel_session_revoked, t0→audit row ≤ 2000 ms,
 * status strip transitions, IndexedDB delete + pluginData zero-out.
 *
 * [NEW] surfaces:
 *   - TunnelSessionManager.revoke({tunnel_session_id})
 *   - PluginStatusStripPort (test fake) — exposes current state string.
 *   - PluginStorageMock.clientStorage / pluginData
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
import {
  PluginStatusStripPort,
  PluginStorageMock,
} from "../../../src/daemon/plugin-port.js";

class FixedIdMockAdapter implements TunnelAdapter {
  async attach(): Promise<TunnelAttachResult> {
    return {
      tunnelUrl: "https://revoke-mock.trycloudflare.com",
      tunnelSessionId: "ts_REVOKE01",
    };
  }
  async detach(): Promise<void> {}
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t7-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T7 1-click revoke from plugin completes within 2s", () => {
  it("Test_Revoke_PluginButton_AllInFlightCalls401AndAuditRowWithin2000ms", async () => {
    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    const statusStrip = new PluginStatusStripPort();
    const storage = new PluginStorageMock();
    const manager = new TunnelSessionManager({
      adapter: new FixedIdMockAdapter(),
      profileId: "claude-cowork-remote",
      statusStrip,
      pluginStorage: storage,
      stdout: process.stdout,
    });
    await manager.confirmOptIn({ confirmed: true });
    const session = await manager.attach({ ttlMs: 30 * 60 * 1000 });
    expect(session.tunnel_session_id).toBe("ts_REVOKE01");

    // Status strip currently shows hashed url.
    expect(statusStrip.current()).toMatch(/^tunnel: [a-f0-9]{8}$/);

    // 3 in-flight calls — kick them off in parallel.
    const inflight = Promise.all([
      manager.handleTunnelCall({ bearer: session.bearer, tunnel_session_id: "ts_REVOKE01", mcp_method: "tools/call", tool_name: "a" }),
      manager.handleTunnelCall({ bearer: session.bearer, tunnel_session_id: "ts_REVOKE01", mcp_method: "tools/call", tool_name: "b" }),
      manager.handleTunnelCall({ bearer: session.bearer, tunnel_session_id: "ts_REVOKE01", mcp_method: "tools/call", tool_name: "c" }),
    ]);

    const t0 = Date.now();
    await manager.revoke({ tunnel_session_id: "ts_REVOKE01" });
    const results = await inflight;
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThanOrEqual(2000);

    for (const r of results) {
      expect(r.status).toBe(401);
      expect(Object.keys(r.body).sort()).toEqual(["error", "tunnel_session_id"]);
      expect(r.body.error).toBe("tunnel_session_revoked");
      expect(r.body.tunnel_session_id).toBe("ts_REVOKE01");
    }

    // Status strip transitioned.
    expect(statusStrip.current()).toBe("tunnel: revoked");

    // pluginData token hash zero-out + clientStorage bearer deleted.
    expect(storage.pluginData.get("autopus.session.token_hash")).toBe("0".repeat(64));
    expect(await storage.clientStorage.getAsync("autopus.session.bearer")).toBeUndefined();

    // Audit row.
    const auditPath = join(workDir, ".autopus", "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const rows = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const revoked = rows.filter(
      (r) => r.event === "tunnel_session_revoked" && r.tunnel_session_id === "ts_REVOKE01",
    );
    expect(revoked).toHaveLength(1);

    await daemon.shutdown();
  });
});
