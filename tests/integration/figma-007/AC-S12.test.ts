// SPEC-FIGMA-007 AC-S12: 30-frame sequential approve oracle — audit chain unbroken,
// zero drift abort, idempotency holds across the second pass.
// Linked: REQ-09, REQ-10, REQ-11, REQ-18 | INV-002 (extend), INV-003 (extend), INV-008, INV-010.

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { MockPluginBridge } from "./__helpers/mock-plugin-bridge.js";
import {
  EXPECTED_FIRST_PROMPT_SHA256,
  EXPECTED_LAST_PROMPT_SHA256,
  EXPECTED_MANIFEST_HASHES,
  EXPECTED_TELEMETRY_KEYS_SORTED,
  NFR01_RSS_BYTES_LIMIT,
  isOracleLocked,
} from "./AC-S12.fixtures.js";

interface DaemonLike {
  boot: () => Promise<void>;
  shutdown: () => Promise<void>;
  onSelectionChange?: (payload: Record<string, unknown>) => Promise<void>;
  processNextSelection?: () => Promise<void>;
  dryRunWrite?: (args: {
    frame_id: string;
    write_target: string;
  }) => Promise<Record<string, unknown>>;
  applyApprovedWrite?: (args: {
    pending_id: string;
    source_hash_recomputed: string;
  }) => Promise<Record<string, unknown>>;
  readAppliedWrites?: () => Array<Record<string, unknown>>;
  getEmittedAudits?: () => Array<Record<string, unknown>>;
  getDaemonEmitterAudits?: () => Array<Record<string, unknown>>;
  getWriteRouterAudits?: () => Array<Record<string, unknown>>;
  getTelemetryRows?: () => Array<Record<string, unknown>>;
  attachPluginBridge?: (bridge: MockPluginBridge) => void;
}

function readDaemonEmitter(daemon: DaemonLike): Array<Record<string, unknown>> {
  if (typeof daemon.getDaemonEmitterAudits === "function") {
    return daemon.getDaemonEmitterAudits();
  }
  if (typeof daemon.getEmittedAudits === "function") {
    return daemon
      .getEmittedAudits()
      .filter((a) => typeof a.prompt_sha256 === "string");
  }
  return [];
}

function readWriteRouter(daemon: DaemonLike): Array<Record<string, unknown>> {
  if (typeof daemon.getWriteRouterAudits === "function") {
    return daemon.getWriteRouterAudits();
  }
  if (typeof daemon.getEmittedAudits === "function") {
    return daemon
      .getEmittedAudits()
      .filter((a) => typeof a.prompt_sha256 !== "string");
  }
  return [];
}

async function bootDaemon(): Promise<DaemonLike> {
  const mod = (await import("../../../src/daemon/server.js")) as Record<
    string,
    unknown
  >;
  const Daemon = mod.Daemon as new (opts: Record<string, unknown>) => DaemonLike;
  const daemon = new Daemon({ transport: "stdio", port: 0 });
  await daemon.boot();
  return daemon;
}

interface FrameFixture {
  figma_node_id: string;
  screen_id: string;
  node_tree_summary: Record<string, unknown>;
}

function loadFrames(): FrameFixture[] {
  const fixturePath = resolve(
    process.cwd(),
    "fixtures/30-frame-mock/frames.json",
  );
  const raw = readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as { frames: FrameFixture[] };
  return parsed.frames;
}

describe("AC-S12: 30-frame sequential approve oracle", () => {
  it("sequential dryRun → approve → apply over 30 frames yields 30 applied + 60 audit + zero drift abort + 30 distinct manifest hashes", async () => {
    const daemon = await bootDaemon();
    const bridge = new MockPluginBridge();
    if (typeof daemon.attachPluginBridge !== "function") {
      throw new Error("daemon.attachPluginBridge not implemented (W2 pending)");
    }
    daemon.attachPluginBridge(bridge);

    if (typeof daemon.dryRunWrite !== "function") {
      throw new Error("daemon.dryRunWrite not implemented (W2 pending)");
    }
    if (typeof daemon.applyApprovedWrite !== "function") {
      throw new Error("daemon.applyApprovedWrite not implemented (W2 pending)");
    }

    const frames = loadFrames();
    expect(frames.length).toBe(30);

    const manifestHashes: string[] = [];
    for (const frame of frames) {
      if (typeof daemon.onSelectionChange === "function") {
        await daemon.onSelectionChange({
          figma_node_id: frame.figma_node_id,
          screen_id: frame.screen_id,
          node_tree_summary: frame.node_tree_summary,
        });
      }
      // Drain the read pipeline → daemon-emitter audit record (read event).
      if (typeof daemon.processNextSelection === "function") {
        await daemon.processNextSelection();
      }
      const pending = await daemon.dryRunWrite({
        frame_id: frame.figma_node_id,
        write_target: "annotation_card",
      });
      const applied = await daemon.applyApprovedWrite({
        pending_id: pending.pending_id as string,
        source_hash_recomputed: pending.source_hash_dryrun as string,
      });
      expect(applied.status).toBe("applied");
      manifestHashes.push(pending.manifest_entry_hash as string);
    }

    // 30 applied_writes
    if (typeof daemon.readAppliedWrites !== "function") {
      throw new Error("daemon.readAppliedWrites not implemented (W2 pending)");
    }
    expect(daemon.readAppliedWrites().length).toBe(30);

    // 60 daemon-emitter records (30 read + 30 write events) — each carries
    // a 64-hex prompt_sha256 from the SPEC-FIGMA-003 INV-003 chain.
    const emitterAudits = readDaemonEmitter(daemon);
    expect(emitterAudits.length).toBe(60);
    for (const a of emitterAudits) {
      expect(a.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
    }

    // Write-router rows: zero drift-abort, zero idempotent-skip on first pass.
    const writeRouterAudits = readWriteRouter(daemon);
    expect(
      writeRouterAudits.filter((a) => a.reason === "APPLY_DRIFT_ABORT").length,
    ).toBe(0);
    expect(
      writeRouterAudits.filter((a) => a.reason === "IDEMPOTENT_SKIP").length,
    ).toBe(0);

    // Pairwise distinct manifest hashes.
    expect(new Set(manifestHashes).size).toBe(30);

    // Oracle hash check — capture mode emits to stdout for first-pass lock,
    // verify against locked fixtures otherwise.
    if (process.env.AUTOPUS_AC_S12_LOCK === "capture") {
      const captured = {
        EXPECTED_FIRST_PROMPT_SHA256: emitterAudits[0].prompt_sha256,
        EXPECTED_LAST_PROMPT_SHA256: emitterAudits[59].prompt_sha256,
        EXPECTED_MANIFEST_HASHES: manifestHashes,
      };
      // eslint-disable-next-line no-console
      console.log(
        "AUTOPUS_AC_S12_CAPTURE_BEGIN" +
          JSON.stringify(captured) +
          "AUTOPUS_AC_S12_CAPTURE_END",
      );
    } else if (isOracleLocked()) {
      expect(emitterAudits[0].prompt_sha256).toBe(EXPECTED_FIRST_PROMPT_SHA256);
      expect(emitterAudits[59].prompt_sha256).toBe(EXPECTED_LAST_PROMPT_SHA256);
      for (let i = 0; i < 30; i += 1) {
        expect(manifestHashes[i]).toBe(EXPECTED_MANIFEST_HASHES[i]);
      }
    }

    // Telemetry: 30 rows, 11-key set per row.
    if (typeof daemon.getTelemetryRows === "function") {
      const rows = daemon.getTelemetryRows();
      expect(rows.length).toBe(30);
      for (const r of rows) {
        expect(Object.keys(r).sort()).toEqual(
          Array.from(EXPECTED_TELEMETRY_KEYS_SORTED).sort(),
        );
        expect(r.dryrun_count).toBe(1);
        expect(r.approve_count).toBe(1);
        expect(r.undo_count).toBe(0);
        expect(r.apply_drift_abort_count).toBe(0);
      }
    }

    // RSS stays under NFR-01 256 MB cap.
    expect(process.memoryUsage().rss).toBeLessThan(NFR01_RSS_BYTES_LIMIT);

    // Second pass — same 30 inputs without daemon restart yield 30 IDEMPOTENT_SKIP rows
    // and zero new applied_writes entries.
    const writeRouterBeforeSecondPass = readWriteRouter(daemon).length;
    for (const frame of frames) {
      const pending = await daemon.dryRunWrite({
        frame_id: frame.figma_node_id,
        write_target: "annotation_card",
      });
      const replay = await daemon.applyApprovedWrite({
        pending_id: pending.pending_id as string,
        source_hash_recomputed: pending.source_hash_dryrun as string,
      });
      expect(replay.status).toBe("skipped");
    }
    expect(daemon.readAppliedWrites().length).toBe(30); // unchanged
    const writeRouterAfter = readWriteRouter(daemon);
    const skippedRowsAdded = writeRouterAfter
      .slice(writeRouterBeforeSecondPass)
      .filter((a) => a.reason === "IDEMPOTENT_SKIP");
    expect(skippedRowsAdded.length).toBe(30);

    await daemon.shutdown();
  });
});
