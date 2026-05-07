// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S13.
// Crash recovery — stale PID detection + daemon_recovered_from_crash row +
// queue rebuild from JSONL tail with original ordering.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-crash-int-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-S13: crash recovery rebuilds queue from telemetry tail", () => {
  it("emits daemon_recovered_from_crash AND rebuilds 5-entry FIFO in original order", async () => {
    const stalePid = 999999;
    const autopusDir = join(workDir, ".autopus");
    const teleDir = join(autopusDir, "telemetry");
    mkdirSync(teleDir, { recursive: true });
    writeFileSync(join(autopusDir, "daemon.pid"), String(stalePid), "utf8");

    const fids = ["1:1", "1:2", "1:3", "1:4", "1:5"];
    const lines = fids.map((fid, i) =>
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

    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      cwd: workDir,
      auditDir: autopusDir,
    });
    await daemon.boot();

    const auditLines = readFileSync(join(autopusDir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const recovered = auditLines.filter(
      (r) => r.event === "daemon_recovered_from_crash",
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0].previous_pid).toBe(stalePid);

    const ids = daemon.queue.toArray().map((e: { frame_id: string }) => e.frame_id);
    expect(ids).toEqual(fids);

    const status = await daemon.statusSnapshot();
    expect(status.connected_clients).toBe(0);
    expect(status.last_selection_event_at).toBe(
      new Date(2026, 4, 7, 0, 0, 4).toISOString(),
    );

    await daemon.shutdown();
  });
});
