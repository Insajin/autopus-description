/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T2.
 *
 * Cowork tunnel attach handshake with mock cloudflared adapter.
 * REQ-03 (opt-in), REQ-04 (per-session bearer + TTL), INV-T3 lifecycle.
 *
 * Implementation surfaces under test (none of these exist yet):
 *   - src/daemon/tunnel-session-manager.ts → TunnelSessionManager
 *   - src/daemon/tunnel-adapter.ts → TunnelAdapter interface, MockTunnelAdapter
 *   - Daemon.attachTunnel(): Promise<TunnelSession>
 *   - audit row event "tunnel_session_attached"
 *   - stdout JSON line event "tunnel_attached"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
// [NEW] expected exports — failing imports drive RED state.
import {
  TunnelSessionManager,
  type TunnelAdapter,
  type TunnelAttachResult,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} from "../../../src/daemon/tunnel-session-manager.js";

const ATTACHED_KEYS = [
  "bearer_sha256",
  "event",
  "transport",
  "ttl_ms",
  "tunnel_session_id",
  "tunnel_url_hash",
];

const AUDIT_KEYS = [
  "attached_at",
  "bearer_sha256",
  "event",
  "profile_id",
  "ttl_ms",
  "tunnel_session_id",
];

class StubMockAdapter implements TunnelAdapter {
  spawnCount = 0;
  async attach(): Promise<TunnelAttachResult> {
    this.spawnCount += 1;
    const start = Date.now();
    while (Date.now() - start < 25) {
      // bounded sync wait — well under 1500ms budget
    }
    return {
      tunnelUrl: "https://abc123-mock.trycloudflare.com",
    };
  }
  async detach(): Promise<void> {}
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t2-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T2 cowork tunnel attach handshake", () => {
  it("Test_TunnelAttach_HandshakeWithMockAdapter_ReturnsAttachedAndPrintsHashedUrlAndAuditRow", async () => {
    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    const adapter = new StubMockAdapter();
    // [NEW] hand the adapter into the daemon's tunnel manager.
    const manager = new TunnelSessionManager({
      adapter,
      profileId: "claude-cowork-remote",
      auditEmit: (row) => daemon.getDaemonEmitterAudits().push(row as never),
      stdout: process.stdout,
    });

    // Simulate plugin opt-in confirmation BEFORE attach.
    await manager.confirmOptIn({ confirmed: true });

    const stdoutLines: string[] = [];
    manager.captureStdout((line: string) => stdoutLines.push(line));

    const t0 = Date.now();
    const session = await daemon.attachTunnel({ manager });
    const elapsed = Date.now() - t0;

    expect(session.status).toBe("attached");
    expect(session.bearer).toMatch(/^bearer_[A-Za-z0-9_-]{32,}$/);
    expect(elapsed).toBeLessThanOrEqual(5000);

    // Exactly one stdout line with key set ATTACHED_KEYS and event === "tunnel_attached".
    const attachedStdoutLines = stdoutLines
      .map((l) => {
        try { return JSON.parse(l) as Record<string, unknown>; }
        catch { return null; }
      })
      .filter((o): o is Record<string, unknown> => !!o && o.event === "tunnel_attached");
    expect(attachedStdoutLines).toHaveLength(1);
    expect(Object.keys(attachedStdoutLines[0]).sort()).toEqual(ATTACHED_KEYS);

    // 8-char hex prefix only — full URL never printed.
    expect(String(attachedStdoutLines[0].tunnel_url_hash)).toMatch(/^[a-f0-9]{8}$/);
    const all = stdoutLines.join("\n");
    expect(all).not.toMatch(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);

    // Audit row.
    const auditPath = join(workDir, ".autopus", "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const audit = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "tunnel_session_attached");
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]).sort()).toEqual(AUDIT_KEYS);
    expect(Number(audit[0].ttl_ms)).toBeLessThanOrEqual(28_800_000);

    await daemon.shutdown();
  });
});
