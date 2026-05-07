// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-13, AC-S13.
// Stale PID detection + daemon_recovered_from_crash audit + queue rebuild from JSONL tail.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../src/daemon/server.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-crash-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeStalePidAndTelemetry(staleP: number) {
  const autopusDir = join(workDir, ".autopus");
  const teleDir = join(autopusDir, "telemetry");
  mkdirSync(teleDir, { recursive: true });
  writeFileSync(join(autopusDir, "daemon.pid"), String(staleP), "utf8");

  const lines = ["1:1", "1:2", "1:3", "1:4", "1:5"].map((fid, i) =>
    JSON.stringify({
      frame_id: fid,
      selection_to_chat_ms: 50,
      generation_ms: 1500,
      ai_requery_count: 0,
      dwell_ms: 100,
      rss_mb: 64,
      ts: new Date(2026, 4, 7, 0, 0, i).toISOString(),
    }),
  );
  writeFileSync(join(teleDir, "phase0.jsonl"), lines.join("\n") + "\n", "utf8");
}

describe("Crash recovery (REQ-13, AC-S13)", () => {
  it("emits exactly one daemon_recovered_from_crash audit row with previous_pid", async () => {
    const stalePid = 999999; // not a live process
    writeStalePidAndTelemetry(stalePid);

    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      cwd: workDir,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    const auditLines = readFileSync(
      join(workDir, ".autopus", "audit.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const recovered = auditLines.filter(
      (r) => r.event === "daemon_recovered_from_crash",
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0].previous_pid).toBe(stalePid);

    await daemon.shutdown();
  });

  it("rebuilds the in-memory selection FIFO from the JSONL tail in original order", async () => {
    writeStalePidAndTelemetry(999999);
    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      cwd: workDir,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();
    const ids = daemon.queue.toArray().map((e: { frame_id: string }) => e.frame_id);
    expect(ids).toEqual(["1:1", "1:2", "1:3", "1:4", "1:5"]);
    await daemon.shutdown();
  });
});
