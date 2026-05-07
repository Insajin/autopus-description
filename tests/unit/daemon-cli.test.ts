// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-01, AC-S5
// Asserts daemon CLI start/stop/status, PID file shape, structured `booted` JSON line,
// and session_token regex. All tests MUST fail (module does not yet exist).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDaemonCli } from "../../src/daemon/cli.js";

const BOOTED_LINE_REGEX =
  /^\{"event":"booted","pid":\d+,"transport":"stdio","port":\d+,"session_token":"[A-Za-z0-9_-]{32,}"\}$/;

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-daemon-cli-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("daemon CLI (REQ-01, AC-S5)", () => {
  it("start prints exactly one structured `booted` JSON line matching the regex", async () => {
    const result = await runDaemonCli(["start", "--transport=stdio", "--port=0"], {
      cwd: workDir,
    });
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(BOOTED_LINE_REGEX);
  });

  it("start writes PID file at .autopus/daemon.pid containing the same pid", async () => {
    const result = await runDaemonCli(["start", "--transport=stdio", "--port=0"], {
      cwd: workDir,
    });
    const parsed = JSON.parse(result.stdout.trim());
    const pidPath = join(workDir, ".autopus", "daemon.pid");
    expect(existsSync(pidPath)).toBe(true);
    const pidFromFile = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
    expect(pidFromFile).toBe(parsed.pid);
  });

  it("status returns JSON object with the exact 6-key set", async () => {
    await runDaemonCli(["start", "--transport=stdio", "--port=0"], { cwd: workDir });
    const status = await runDaemonCli(["status"], { cwd: workDir });
    const parsed = JSON.parse(status.stdout.trim());
    expect(Object.keys(parsed).sort()).toEqual([
      "connected_clients",
      "last_selection_event_at",
      "pid",
      "port",
      "transport",
      "uptime_ms",
    ]);
    expect(typeof parsed.connected_clients).toBe("number");
    expect(parsed.connected_clients).toBeGreaterThanOrEqual(0);
  });

  it("stop removes the PID file and a subsequent status exits 1 with stderr message", async () => {
    await runDaemonCli(["start", "--transport=stdio", "--port=0"], { cwd: workDir });
    const stop = await runDaemonCli(["stop"], { cwd: workDir });
    expect(stop.exitCode).toBe(0);
    expect(existsSync(join(workDir, ".autopus", "daemon.pid"))).toBe(false);

    const status = await runDaemonCli(["status"], { cwd: workDir });
    expect(status.exitCode).toBe(1);
    expect(status.stderr).toContain("daemon not running");
  });

  it("session_token printed once on start matches the strong-token character class", async () => {
    const result = await runDaemonCli(["start", "--transport=stdio", "--port=0"], {
      cwd: workDir,
    });
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.session_token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });
});
