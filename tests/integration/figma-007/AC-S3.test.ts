// SPEC-FIGMA-007 AC-S3: Idempotent re-apply yields no-op (5 retries).
// Linked: REQ-07, NFR-07 | INV-010 deduplication via existing manifest_entry_hash.

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
  readAppliedWrites?: () => Array<Record<string, unknown>>;
  getEmittedAudits?: () => Array<Record<string, unknown>>;
  attachPluginBridge?: (bridge: MockPluginBridge) => void;
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

describe("AC-S3: Idempotent re-apply yields no-op with concrete oracle (5 retries)", () => {
  it("5 sequential approves on the same identical entry record callCount=0 after first apply, with 5 SKIPPED audit rows", async () => {
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

    // First pass — should apply.
    const first = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });
    const firstResult = await daemon.applyApprovedWrite({
      pending_id: first.pending_id as string,
      source_hash_recomputed: first.source_hash_dryrun as string,
    });
    expect(firstResult.status).toBe("applied");
    const callsAfterFirstApply = bridge.snapshot().callCount;
    expect(callsAfterFirstApply).toBeGreaterThanOrEqual(1);

    // 5 retries with fresh pending_id but identical entry — all should yield IDEMPOTENT_SKIP.
    const expectedHash = first.manifest_entry_hash as string;
    for (let i = 0; i < 5; i += 1) {
      const retry = await daemon.dryRunWrite({
        frame_id: "1:1",
        write_target: "annotation_card",
      });
      // Hash must byte-equal regardless of pending_id (deterministic hash of identical entry)
      expect(retry.manifest_entry_hash).toBe(expectedHash);

      const skipped = await daemon.applyApprovedWrite({
        pending_id: retry.pending_id as string,
        source_hash_recomputed: retry.source_hash_dryrun as string,
      });
      expect(skipped.status).toBe("skipped");
      expect(skipped.reason).toBe("IDEMPOTENT_SKIP");
      expect(skipped.manifest_entry_hash).toBe(expectedHash);
    }

    // Plugin command dispatcher MUST NOT receive any new calls after the first apply.
    const finalCallCount = bridge.snapshot().callCount;
    expect(finalCallCount).toBe(callsAfterFirstApply);

    // Audit rows: 1 success + 5 skipped, all keyed by the same manifest_entry_hash.
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const skippedRows = audits.filter(
      (a) => a.status === "skipped" && a.reason === "IDEMPOTENT_SKIP",
    );
    expect(skippedRows.length).toBe(5);
    for (const row of skippedRows) {
      expect(Object.keys(row).sort()).toEqual(
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
      expect(row.manifest_entry_hash).toBe(expectedHash);
    }

    // applied_writes resource length stays at 1 (no new applied entry).
    if (typeof daemon.readAppliedWrites !== "function") {
      throw new Error("daemon.readAppliedWrites not implemented (W2 pending)");
    }
    expect(daemon.readAppliedWrites().length).toBe(1);

    await daemon.shutdown();
  });
});
