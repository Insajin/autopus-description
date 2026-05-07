/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T4.
 *
 * REQ-03: tunnel opt-in confirmation gate. WITHOUT confirm message, no tunnel
 * URL is published. With confirm=false, tunnel state moves to "declined" and
 * mock adapter is never spawned (spawnCount === 0).
 *
 * [NEW] surfaces: TunnelSessionManager.confirmOptIn, .status, attachTunnel
 *   precondition that confirm.confirmed === true.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
import {
  TunnelSessionManager,
  type TunnelAdapter,
  type TunnelAttachResult,
} from "../../../src/daemon/tunnel-session-manager.js";

class CountingMockAdapter implements TunnelAdapter {
  spawnCount = 0;
  async attach(): Promise<TunnelAttachResult> {
    this.spawnCount += 1;
    return { tunnelUrl: "https://never-spawned.trycloudflare.com" };
  }
  async detach(): Promise<void> {}
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t4-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T4 tunnel opt-in confirmation gate", () => {
  it("Test_OptIn_NoConfirmMessage_PendingState_NoUrlLeak_Within3000ms", async () => {
    const daemon = new Daemon({ auditDir: join(workDir, ".autopus") });
    await daemon.boot();

    const adapter = new CountingMockAdapter();
    const manager = new TunnelSessionManager({
      adapter,
      profileId: "claude-cowork-remote",
      stdout: process.stdout,
    });

    const stdoutLines: string[] = [];
    manager.captureStdout((line: string) => stdoutLines.push(line));

    // Wait 3 s wall time without sending confirm.
    await new Promise((r) => setTimeout(r, 3000));

    expect(manager.status).toBe("pending_confirm");

    const pending = stdoutLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && o.event === "tunnel_pending_confirm");
    expect(pending).toHaveLength(1);
    expect(pending[0].timeout_ms).toBe(30_000);

    // No tunnel_url_hash leak.
    const all = stdoutLines.join("\n");
    expect(all).not.toMatch(/tunnel_url_hash/);

    // No tunnel_session_attached audit row.
    const auditPath = join(workDir, ".autopus", "audit.jsonl");
    if (existsSync(auditPath)) {
      const rows = readFileSync(auditPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const attached = rows.filter((r) => r.event === "tunnel_session_attached");
      expect(attached).toHaveLength(0);
    }

    await daemon.shutdown();
  }, 6000);

  it("Test_OptIn_DeclineMessage_TransitionsToDeclined_NoSpawn", async () => {
    const daemon = new Daemon({ auditDir: join(workDir, ".autopus") });
    await daemon.boot();

    const adapter = new CountingMockAdapter();
    const manager = new TunnelSessionManager({
      adapter,
      profileId: "claude-cowork-remote",
      stdout: process.stdout,
    });

    const stdoutLines: string[] = [];
    manager.captureStdout((line: string) => stdoutLines.push(line));

    await manager.confirmOptIn({ confirmed: false });

    expect(manager.status).toBe("declined");
    expect(adapter.spawnCount).toBe(0);

    const declined = stdoutLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && o.event === "tunnel_optin_declined");
    expect(declined).toHaveLength(1);

    await daemon.shutdown();
  });
});
