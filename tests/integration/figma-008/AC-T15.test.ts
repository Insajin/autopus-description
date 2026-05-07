/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T15 (Should).
 *
 * NFR-09: probe staleness warning at start. Verified row > 30 days old →
 * one stdout JSON probe_stale_warning line + non-zero exit suppressed +
 * tunnel attaches successfully.
 *
 * [NEW] surfaces:
 *   - Daemon.startWithFlags({tunnel: "cloudflared"}) emits stale-probe warning
 *     when last verified row's finished_at is > 30 days old.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
import {
  TunnelSessionManager,
  type TunnelAdapter,
  type TunnelAttachResult,
} from "../../../src/daemon/tunnel-session-manager.js";

class StaleMockAdapter implements TunnelAdapter {
  async attach(): Promise<TunnelAttachResult> {
    return { tunnelUrl: "https://stale-mock.trycloudflare.com" };
  }
  async detach(): Promise<void> {}
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t15-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T15 probe staleness warning at start", () => {
  it("Test_StartWithStaleVerifiedRow_PrintsWarningLine_ExitZero_TunnelAttaches", async () => {
    const probesDir = join(workDir, ".autopus", "probes");
    mkdirSync(probesDir, { recursive: true });

    // 35 days ago — staler than 30 day threshold.
    const finishedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      JSON.stringify({
        probe_target: "claude-cowork",
        started_at: finishedAt,
        finished_at: finishedAt,
        status: "verified",
        mcp_protocol_version: 1,
        capabilities_advertised: ["resources.read", "tools.call", "fallback.polling"],
        error_text_redacted: "",
        doc_excerpt: "",
      }) + "\n",
      "utf8",
    );

    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
      cwd: workDir,
    });
    daemon.attachTunnelManager(
      new TunnelSessionManager({
        adapter: new StaleMockAdapter(),
        profileId: "claude-cowork-remote",
        stdout: process.stdout,
      }),
    );

    const stdoutLines: string[] = [];
    const result = await daemon.startWithFlags({
      transport: "http",
      tunnel: "cloudflared",
      port: 0,
      stdoutSink: (l: string) => stdoutLines.push(l),
    });

    const warnings = stdoutLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && o.event === "probe_stale_warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].probe_target).toBe("claude-cowork");
    expect(Number(warnings[0].stale_days)).toBeGreaterThanOrEqual(30);

    expect(result.exitCode).toBe(0);
    expect(result.tunnelAttached).toBe(true);

    await daemon.shutdown();
  });
});
