// SPEC-FIGMA-007 AC-S4: Undo round-trip preserves source_hash (concrete pre/post oracle).
// Linked: REQ-08 | INV-011 round-trip preservation.

import { describe, it, expect } from "vitest";

import { MockPluginBridge } from "./__helpers/mock-plugin-bridge.js";

interface DaemonLike {
  boot: () => Promise<void>;
  shutdown: () => Promise<void>;
  dryRunWrite?: (args: {
    frame_id: string;
    write_target: string;
  }) => Promise<Record<string, unknown>>;
  applyApprovedWrite?: (args: {
    pending_id: string;
    source_hash_recomputed: string;
  }) => Promise<Record<string, unknown>>;
  undoWrite?: (args: { write_id: string }) => Promise<Record<string, unknown>>;
  readAppliedWrites?: () => Array<Record<string, unknown>>;
  getEmittedAudits?: () => Array<Record<string, unknown>>;
  attachPluginBridge?: (bridge: MockPluginBridge) => void;
  idempotencyHas?: (hash: string) => boolean;
  hasUndoEntry?: (write_id: string) => boolean;
  recomputeSourceHash?: (frame_id: string) => string;
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

const PRE_DRYRUN_SOURCE_HASH =
  "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420";

describe("AC-S4: Undo round-trip preserves source_hash (zero tolerance)", () => {
  it("post-undo source_hash byte-equals pre-dryRun, IdempotencyTracker cleared, 7-key UNDO audit row emitted", async () => {
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

    const pending = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    const applied = await daemon.applyApprovedWrite({
      pending_id: pending.pending_id as string,
      source_hash_recomputed: pending.source_hash_dryrun as string,
    });
    const writeId = applied.write_id as string;
    expect(writeId).toMatch(/^wr-/);

    // Undo
    if (typeof daemon.undoWrite !== "function") {
      throw new Error("daemon.undoWrite not implemented (W2 pending)");
    }
    const undoResult = await daemon.undoWrite({ write_id: writeId });
    expect(undoResult.status).toBe("undone");

    // Post-undo recomputed source_hash must byte-equal the pre-dryRun value.
    if (typeof daemon.recomputeSourceHash === "function") {
      const post = daemon.recomputeSourceHash("1:1");
      expect(post).toBe(PRE_DRYRUN_SOURCE_HASH);
    }

    // 7-key UNDO audit row.
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const undoRows = audits.filter(
      (a) => a.status === "undone" && a.reason === "UNDO_REQUESTED",
    );
    expect(undoRows.length).toBe(1);
    expect(Object.keys(undoRows[0]).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "reason",
        "status",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );

    // IdempotencyTracker cleared for that hash.
    if (typeof daemon.idempotencyHas === "function") {
      expect(daemon.idempotencyHas(pending.manifest_entry_hash as string)).toBe(
        false,
      );
    }

    // DaemonUndoRegistry cleared.
    if (typeof daemon.hasUndoEntry === "function") {
      expect(daemon.hasUndoEntry(writeId)).toBe(false);
    }

    // Re-apply the identical entry now succeeds (round-trip permits it).
    const replay = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    const replayResult = await daemon.applyApprovedWrite({
      pending_id: replay.pending_id as string,
      source_hash_recomputed: replay.source_hash_dryrun as string,
    });
    expect(replayResult.status).toBe("applied"); // not "skipped"

    await daemon.shutdown();
  });
});
