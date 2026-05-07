/**
 * SPEC-FIGMA-008 Phase 3 — coverage tests for tunnel-bind.ts.
 *
 * Targets uncovered branches:
 *   - dispatchToolCall: unknown profile, missing tools.call, suggested_fallback
 *     for non-cowork profile, capability_mismatch audit emission
 *   - startWithFlagsImpl: tunnel === undefined branch, failed-probe early
 *     return (line 144), corrupt-line catch in readLastCoworkProbe (line 202),
 *     stale-probe warning, missing tunnelManager branch
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dispatchToolCallImpl, startWithFlagsImpl } from "../../src/daemon/tunnel-bind.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { TunnelSessionManager } from "../../src/daemon/tunnel-session-manager.js";
import { PluginStatusStripPort } from "../../src/daemon/plugin-port.js";
import type { TunnelAdapter, TunnelAttachResult } from "../../src/daemon/tunnel-adapter.js";

class TrivialAdapter implements TunnelAdapter {
  async attach(): Promise<TunnelAttachResult> {
    return { tunnelUrl: "https://bind-test.trycloudflare.com" };
  }
  async detach(): Promise<void> {}
}

let workDir: string;
let audit: DaemonAuditWriter;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-tbind-"));
  audit = new DaemonAuditWriter({ auditDir: workDir, provider: "test" });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("dispatchToolCallImpl (SPEC-FIGMA-008 unit)", () => {
  it("returns -32601 with unknown_profile when profile_id does not match registry", () => {
    const r = dispatchToolCallImpl(audit, {
      profileId: "ghost-profile",
      toolName: "anything",
    });
    expect(r.error?.code).toBe(-32601);
    expect(r.error?.data.profile_id).toBe("ghost-profile");
    expect(r.error?.data.missing_capability).toBe("unknown_profile");
    expect(r.error?.data.suggested_fallback).toBe("claude-code-local");
  });

  it("returns ok=true when profile has the required tools.call capability", () => {
    const r = dispatchToolCallImpl(audit, {
      profileId: "claude-code-local",
      toolName: "figma.read",
    });
    expect(r.ok).toBe(true);
  });

  it("write tool on cowork profile returns -32601 with suggested_fallback=claude-code-local", () => {
    const r = dispatchToolCallImpl(audit, {
      profileId: "claude-cowork-remote",
      toolName: "figma.applyDescription",
    });
    expect(r.error?.code).toBe(-32601);
    expect(r.error?.data.missing_capability).toBe("write.tools");
    expect(r.error?.data.suggested_fallback).toBe("claude-code-local");
  });

  it("write tool on local profile returns -32601 with suggested_fallback equal to that profile's id", () => {
    const r = dispatchToolCallImpl(audit, {
      profileId: "codex-windows-stdio",
      toolName: "figma.applyDescription",
    });
    expect(r.error?.data.suggested_fallback).toBe("codex-windows-stdio");
  });

  it("emits one capability_mismatch audit row with tool_name + requested_profile + missing_capability", () => {
    dispatchToolCallImpl(audit, {
      profileId: "claude-cowork-remote",
      toolName: "figma.applyDescription",
    });
    const rows = readFileSync(join(workDir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "capability_mismatch");
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_name).toBe("figma.applyDescription");
    expect(rows[0].requested_profile).toBe("claude-cowork-remote");
    expect(rows[0].missing_capability).toBe("write.tools");
  });
});

describe("startWithFlagsImpl (SPEC-FIGMA-008 unit)", () => {
  it("undefined tunnel flag = default-safe (same path as tunnel: false)", async () => {
    const lines: string[] = [];
    const r = await startWithFlagsImpl(
      { auditDir: workDir },
      { transport: "http", port: 0, stdoutSink: (l) => lines.push(l) },
    );
    expect(r.exitCode).toBe(0);
    expect(r.tunnelAttached).toBe(false);
    expect(r.cloudflaredSpawnCount).toBe(0);
    const safe = lines.map((l) => JSON.parse(l)).filter((o) => o.event === "opsec_default_safe");
    expect(safe).toHaveLength(1);
    expect(safe[0].tunnel).toBe(false);
  });

  it("returns exitCode 1 + empty sockets when last cowork probe row has status: 'failed'", async () => {
    const probesDir = join(workDir, "probes");
    mkdirSync(probesDir, { recursive: true });
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      JSON.stringify({
        probe_target: "claude-cowork",
        status: "failed",
        finished_at: new Date().toISOString(),
      }) + "\n",
      "utf8",
    );
    const r = await startWithFlagsImpl(
      { auditDir: workDir },
      { transport: "http", tunnel: "cloudflared", port: 0 },
    );
    expect(r.exitCode).toBe(1);
    expect(r.listeningSockets).toHaveLength(0);
    expect(r.tunnelAttached).toBe(false);
  });

  it("emits probe_stale_warning when last verified row's finished_at is > 30 days old", async () => {
    const probesDir = join(workDir, "probes");
    mkdirSync(probesDir, { recursive: true });
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      JSON.stringify({
        probe_target: "claude-cowork",
        status: "verified",
        finished_at: old,
      }) + "\n",
      "utf8",
    );
    const lines: string[] = [];
    const r = await startWithFlagsImpl(
      { auditDir: workDir },
      {
        transport: "http",
        tunnel: "cloudflared",
        port: 0,
        stdoutSink: (l) => lines.push(l),
      },
    );
    expect(r.exitCode).toBe(0);
    const warns = lines
      .map((l) => JSON.parse(l))
      .filter((o) => o.event === "probe_stale_warning");
    expect(warns).toHaveLength(1);
    expect(warns[0].stale_days).toBeGreaterThanOrEqual(30);
  });

  it("does NOT emit probe_stale_warning when verified row is fresh (≤ 30 days)", async () => {
    const probesDir = join(workDir, "probes");
    mkdirSync(probesDir, { recursive: true });
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      JSON.stringify({
        probe_target: "claude-cowork",
        status: "verified",
        finished_at: new Date().toISOString(),
      }) + "\n",
      "utf8",
    );
    const lines: string[] = [];
    await startWithFlagsImpl(
      { auditDir: workDir },
      {
        transport: "http",
        tunnel: "cloudflared",
        port: 0,
        stdoutSink: (l) => lines.push(l),
      },
    );
    const warns = lines
      .map((l) => JSON.parse(l))
      .filter((o) => o.event === "probe_stale_warning");
    expect(warns).toHaveLength(0);
  });

  it("attaches the tunnel via tunnelManager when one is supplied (cloudflaredSpawnCount === 1)", async () => {
    const statusStrip = new PluginStatusStripPort();
    const manager = new TunnelSessionManager({
      adapter: new TrivialAdapter(),
      profileId: "claude-cowork-remote",
      auditPath: join(workDir, "audit.jsonl"),
      statusStrip,
    });
    const r = await startWithFlagsImpl(
      { auditDir: workDir, statusStrip, tunnelManager: manager },
      { transport: "tunnel", tunnel: "cloudflared", port: 0 },
    );
    expect(r.tunnelAttached).toBe(true);
    expect(r.cloudflaredSpawnCount).toBe(1);
  });

  it("skips tunnel attach when no manager is provided (cloudflaredSpawnCount === 0)", async () => {
    const r = await startWithFlagsImpl(
      { auditDir: workDir },
      { transport: "tunnel", tunnel: "cloudflared", port: 0 },
    );
    expect(r.exitCode).toBe(0);
    expect(r.tunnelAttached).toBe(false);
    expect(r.cloudflaredSpawnCount).toBe(0);
  });

  it("readLastCoworkProbe ignores corrupt JSON lines and returns null when no valid row exists", async () => {
    const probesDir = join(workDir, "probes");
    mkdirSync(probesDir, { recursive: true });
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      "{not json\n{also not json\n",
      "utf8",
    );
    const r = await startWithFlagsImpl(
      { auditDir: workDir },
      { transport: "http", tunnel: "cloudflared", port: 0 },
    );
    // No failed row → no exit-1 gate. No verified row → no stale warning.
    expect(r.exitCode).toBe(0);
  });

  it("handles malformed finished_at by reporting stale_days = 0 (non-stale)", async () => {
    const probesDir = join(workDir, "probes");
    mkdirSync(probesDir, { recursive: true });
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      JSON.stringify({
        probe_target: "claude-cowork",
        status: "verified",
        finished_at: "not-a-date",
      }) + "\n",
      "utf8",
    );
    const lines: string[] = [];
    await startWithFlagsImpl(
      { auditDir: workDir },
      {
        transport: "http",
        tunnel: "cloudflared",
        port: 0,
        stdoutSink: (l) => lines.push(l),
      },
    );
    const warns = lines
      .map((l) => JSON.parse(l))
      .filter((o) => o.event === "probe_stale_warning");
    expect(warns).toHaveLength(0);
  });
});
