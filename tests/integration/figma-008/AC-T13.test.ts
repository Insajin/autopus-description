/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T13.
 *
 * REQ-13, REQ-16: capability mismatch fallback for cowork write tool, AND
 * cowork-failed-probe gate that refuses --tunnel start with exit code 1.
 *
 * [NEW] surfaces:
 *   - Daemon.dispatchToolCall({profileId, toolName}) → {result?, error?}
 *   - audit row event "capability_mismatch"
 *   - probe-runner-gated CLI start (existing CLI extended).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";
import { runDaemonCli } from "../../../src/daemon/cli.js";

const ERROR_DATA_KEYS = ["missing_capability", "profile_id", "suggested_fallback"];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t13-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T13 capability mismatch fallback for cowork-requested write tool", () => {
  it("Test_CoworkProfile_WriteTool_ReturnsJsonRpcMethodNotFoundWithFallbackData", async () => {
    const daemon = new Daemon({
      transport: "http",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    const r = await daemon.dispatchToolCall({
      profileId: "claude-cowork-remote",
      toolName: "figma.applyDescription",
      args: {},
    });

    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe(-32601);
    expect(Object.keys(r.error!.data).sort()).toEqual(ERROR_DATA_KEYS);
    expect(r.error!.data.profile_id).toBe("claude-cowork-remote");
    expect(r.error!.data.missing_capability).toBe("write.tools");
    expect(r.error!.data.suggested_fallback).toBe("claude-code-local");

    const rows = readFileSync(join(workDir, ".autopus", "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const mismatch = rows.filter(
      (x) =>
        x.event === "capability_mismatch" &&
        x.tool_name === "figma.applyDescription" &&
        x.requested_profile === "claude-cowork-remote",
    );
    expect(mismatch).toHaveLength(1);

    await daemon.shutdown();
  });

  it("Test_CoworkProbeFailed_TunnelStart_ExitsCode1WithStderrSubstring", async () => {
    // Seed a failed probe row.
    const probesDir = join(workDir, ".autopus", "probes");
    mkdirSync(probesDir, { recursive: true });
    writeFileSync(
      join(probesDir, "transport-matrix.jsonl"),
      JSON.stringify({
        probe_target: "claude-cowork",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: "failed",
        mcp_protocol_version: 1,
        capabilities_advertised: [],
        error_text_redacted: "doc unreachable",
        doc_excerpt: "",
      }) + "\n",
      "utf8",
    );

    const result = await runDaemonCli(
      ["start", "--transport=http", "--port=0", "--tunnel=cloudflared"],
      { cwd: workDir },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "cowork probe failed: re-run autopus-daemon start --probe=claude-cowork before enabling tunnel",
    );
  });
});
