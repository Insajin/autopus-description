// SPEC-FIGMA-009 T12 / AC-W5 — Phase 1.5 RED scaffold (lifecycle separation).
// Verifies that `autopus-daemon start` (state-init) and `autopus-mcp-stdio`
// (long-running) are independent processes — killing one MUST NOT affect the
// other (INV-W5). Also asserts the runbook + unverified probe row exist.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { runDaemonCli } from "../../../src/daemon/cli.js";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const STDIO_BIN = join(REPO_ROOT, "dist", "src", "daemon", "mcp-stdio-entry.js");

const BOOTED_RE =
  /^\{"event":"booted","pid":\d+,"transport":"stdio","port":\d+,"session_token":"[A-Za-z0-9_-]{32,}"\}\n$/;

let workDir: string;
let child: ChildProcess | null = null;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-AC-W5-"));
});

afterEach(() => {
  if (child && !child.killed) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  child = null;
  rmSync(workDir, { recursive: true, force: true });
});

function waitForExit(c: ChildProcess, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit) => {
    const t = setTimeout(() => resolveExit({ code: null, signal: null }), ms);
    c.on("exit", (code, signal) => {
      clearTimeout(t);
      resolveExit({ code, signal });
    });
  });
}

describe("AC-W5: lifecycle separation — daemon start ↔ mcp-stdio bin", () => {
  it("autopus-daemon start emits booted JSON line and writes daemon.pid", async () => {
    const result = await runDaemonCli(["start", "--transport=stdio", "--port=0"], {
      cwd: workDir,
    });
    expect(result.exitCode).toBe(0);
    expect(BOOTED_RE.test(result.stdout)).toBe(true);
    const pidPath = join(workDir, ".autopus", "daemon.pid");
    expect(existsSync(pidPath)).toBe(true);
    expect(/^\d+$/.test(readFileSync(pidPath, "utf8").trim())).toBe(true);
  });

  it("autopus-mcp-stdio child stays alive 2s, never prints booted, exits on SIGTERM, daemon.pid preserved", async () => {
    if (!existsSync(STDIO_BIN)) {
      throw new Error(`mcp-stdio bin not built — expected ${STDIO_BIN}. Run 'npm run build' first.`);
    }

    const startResult = await runDaemonCli(["start", "--transport=stdio", "--port=0"], {
      cwd: workDir,
    });
    expect(startResult.exitCode).toBe(0);
    const pidPath = join(workDir, ".autopus", "daemon.pid");
    const originalPid = readFileSync(pidPath, "utf8").trim();

    child = spawn("node", [STDIO_BIN], {
      cwd: workDir,
      env: { ...process.env, AUTOPUS_AUDIT_DIR: join(workDir, ".autopus") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    // Wait 2 seconds and assert child is still alive.
    await new Promise((r) => setTimeout(r, 2000));
    expect(child.exitCode).toBeNull();
    expect(stdout.includes('"event":"booted"')).toBe(false);

    // Send SIGTERM and assert exit within 2s.
    child.kill("SIGTERM");
    const exited = await waitForExit(child, 2000);
    expect(exited.code === 0 || exited.signal === "SIGTERM").toBe(true);

    // daemon.pid still exists with the original PID.
    expect(existsSync(pidPath)).toBe(true);
    expect(readFileSync(pidPath, "utf8").trim()).toBe(originalPid);
  }, 10000);

  it("Codex stdio runbook contains [mcp_servers.autopus_figma] + command='autopus-mcp-stdio'", () => {
    const candidates = [
      join(REPO_ROOT, "docs", "runbooks", "figma-009-codex-stdio.md"),
      join(REPO_ROOT, ".autopus", "specs", "SPEC-FIGMA-009", "research.md"),
    ];
    let body = "";
    for (const path of candidates) {
      if (existsSync(path)) {
        body += readFileSync(path, "utf8");
      }
    }
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("[mcp_servers.autopus_figma]");
    expect(body).toContain('command = "autopus-mcp-stdio"');
  });

  it("transport-matrix.jsonl has codex_windows_stdio unverified row with the 7-key shape", () => {
    const path = join(REPO_ROOT, ".autopus", "probes", "transport-matrix.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const matched = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter(
        (r) => r.probe_target === "codex_windows_stdio" && r.status === "unverified",
      );
    expect(matched.length).toBeGreaterThanOrEqual(1);
    const row = matched[0];
    expect(new Set(Object.keys(row))).toEqual(
      new Set([
        "probe_target",
        "started_at",
        "finished_at",
        "status",
        "mcp_protocol_version",
        "capabilities_advertised",
        "error_text_redacted",
      ]),
    );
    const errText = String(row.error_text_redacted ?? "");
    if (errText.length > 0) {
      expect(/figd_[A-Za-z0-9_-]{16,}/.test(errText)).toBe(false);
    }
  });
});
