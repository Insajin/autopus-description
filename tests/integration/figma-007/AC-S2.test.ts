// SPEC-FIGMA-007 AC-S2: Approve → apply happy path with concrete manifest_entry_hash oracle.
// Linked: REQ-04, REQ-06, REQ-09, REQ-19 | INV-002 (extend), INV-009, INV-010.
//
// RED scaffold — exercises the dryRun → Approve → apply round-trip and
// asserts the daemon emits a 5-key SUCCESS audit row with byte-equal
// manifest_entry_hash, the IdempotencyTracker has the hash recorded, and
// `autopus://applied_writes` advances by one entry.

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
  idempotencyHas?: (hash: string) => boolean;
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

const FROZEN_SOURCE_HASH =
  "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420";

describe("AC-S2: Approve → apply happy path with manifest_entry_hash oracle", () => {
  it("emits exactly one 5-key SUCCESS audit row whose manifest_entry_hash byte-equals the dryRun hash", async () => {
    const daemon = await bootDaemon();
    const bridge = new MockPluginBridge();
    if (typeof daemon.attachPluginBridge !== "function") {
      throw new Error("daemon.attachPluginBridge not implemented (W2 pending)");
    }
    daemon.attachPluginBridge(bridge);

    if (typeof daemon.dryRunWrite !== "function") {
      throw new Error("daemon.dryRunWrite not implemented (W2 pending)");
    }
    const pending = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    if (typeof daemon.applyApprovedWrite !== "function") {
      throw new Error("daemon.applyApprovedWrite not implemented (W2 pending)");
    }

    const t0 = Date.now();
    const result = await daemon.applyApprovedWrite({
      pending_id: pending.pending_id as string,
      source_hash_recomputed: pending.source_hash_dryrun as string,
    });
    const elapsedMs = Date.now() - t0;

    expect(elapsedMs).toBeLessThanOrEqual(2000); // NFR-01

    expect(result.status).toBe("applied");
    expect(result.manifest_entry_hash).toBe(pending.manifest_entry_hash);

    // 5-key SUCCESS audit row contract (NFR-04 frozen)
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const successRows = audits.filter(
      (a) => a.status === undefined && a.manifest_entry_hash !== undefined,
    );
    expect(successRows.length).toBe(1);
    expect(Object.keys(successRows[0]).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );
    expect(successRows[0].manifest_entry_hash).toBe(pending.manifest_entry_hash);
    expect(successRows[0].frame_id).toBe("1:1");

    // IdempotencyTracker contract — hash recorded.
    if (typeof daemon.idempotencyHas === "function") {
      expect(daemon.idempotencyHas(pending.manifest_entry_hash as string)).toBe(
        true,
      );
    }

    // applied_writes resource advanced.
    if (typeof daemon.readAppliedWrites !== "function") {
      throw new Error("daemon.readAppliedWrites not implemented (W2 pending)");
    }
    const applied = daemon.readAppliedWrites();
    expect(applied.length).toBe(1);
    expect(Object.keys(applied[0]).sort()).toEqual(
      [
        "applied_at",
        "frame_id",
        "manifest_entry_hash",
        "undo_descriptor",
        "write_id",
        "write_target",
      ].sort(),
    );

    // The bridge should have received at least one plugin command dispatch.
    expect(bridge.snapshot().callCount).toBeGreaterThanOrEqual(1);

    // Source hash byte-equality oracle (SPEC-FIGMA-002 inheritance).
    expect(pending.source_hash_dryrun).toBe(FROZEN_SOURCE_HASH);

    await daemon.shutdown();
  });
});
