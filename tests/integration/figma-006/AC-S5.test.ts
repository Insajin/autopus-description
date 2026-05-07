// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S5.
// daemon CLI start/stop/status: structured booted line, PID file, status keys, stop teardown.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDaemonCli } from "../../../src/daemon/cli.js";

const BOOTED_RE =
  /^\{"event":"booted","pid":\d+,"transport":"stdio","port":\d+,"session_token":"[A-Za-z0-9_-]{32,}"\}$/;

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-cli-int-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-S5: daemon CLI start/stop/status full lifecycle", () => {
  it("start prints booted line, status returns 6-key set, stop removes PID file", async () => {
    const start = await runDaemonCli(["start", "--transport=stdio", "--port=0"], {
      cwd: workDir,
    });
    const lines = start.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(BOOTED_RE);

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

    const stop = await runDaemonCli(["stop"], { cwd: workDir });
    expect(stop.exitCode).toBe(0);
    expect(existsSync(join(workDir, ".autopus", "daemon.pid"))).toBe(false);

    const status2 = await runDaemonCli(["status"], { cwd: workDir });
    expect(status2.exitCode).toBe(1);
    expect(status2.stderr).toContain("daemon not running");
  });
});
