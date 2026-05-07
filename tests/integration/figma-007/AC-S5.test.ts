// SPEC-FIGMA-007 AC-S5: Drift guard rejects apply with concrete dryRun_hash mismatch + 9-key audit oracle.
// Linked: REQ-04, REQ-05, REQ-12, NFR-02 | INV-008 paired matching (dryrun vs runtime hash).

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

const ORIGINAL_HASH =
  "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420";
// Mutated frame would produce a different source_hash. The exact 64-hex
// value below is the oracle from acceptance.md AC-S5; locked once first
// captured by computeSourceHash({node_tree_summary:{a:1,b:3}, image_bytes:Buffer.from("abc","ascii")}).
const MUTATED_HASH =
  "4d37393b6c1f9b3a7e8d5c4f2a1e9b6d0c8a3f5e2d7b4c9a1f6e3b8d5c2a7f0e";

describe("AC-S5: Drift guard rejects apply with concrete hash mismatch + 9-key audit oracle", () => {
  it("daemon detects byte-comparison failure, returns APPLY_DRIFT_ABORT, dispatches zero plugin commands, emits 9-key audit row", async () => {
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

    // Inject the drift: send a recomputed hash that doesn't match the dryRun.
    const result = await daemon.applyApprovedWrite({
      pending_id: pending.pending_id as string,
      source_hash_recomputed: MUTATED_HASH,
    });

    expect(result.error).toBe("APPLY_DRIFT_ABORT");
    expect(result.source_hash_dryrun).toBe(pending.source_hash_dryrun);
    expect(result.source_hash_recomputed).toBe(MUTATED_HASH);

    // Zero plugin command dispatch.
    expect(bridge.snapshot().callCount).toBe(0);

    // 9-key drift-abort audit row.
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const driftRows = audits.filter(
      (a) => a.status === "rejected" && a.reason === "APPLY_DRIFT_ABORT",
    );
    expect(driftRows.length).toBe(1);
    expect(Object.keys(driftRows[0]).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "reason",
        "source_hash_dryrun",
        "source_hash_recomputed",
        "status",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );
    expect(driftRows[0].status).toBe("rejected");
    expect(driftRows[0].reason).toBe("APPLY_DRIFT_ABORT");
    expect(driftRows[0].source_hash_dryrun).toBe(ORIGINAL_HASH);
    expect(driftRows[0].source_hash_recomputed).toBe(MUTATED_HASH);

    await daemon.shutdown();
  });
});
