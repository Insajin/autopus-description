// SPEC-FIGMA-007 AC-S6: Atomicity — apply without prior dryRun is rejected (MISSING_DRYRUN_GATE).
// Linked: REQ-19 | INV-009 atomicity.

import { describe, it, expect } from "vitest";

import { MockPluginBridge } from "./__helpers/mock-plugin-bridge.js";

interface DaemonLike {
  boot: () => Promise<void>;
  shutdown: () => Promise<void>;
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

describe("AC-S6: Apply without prior dryRun is rejected (MISSING_DRYRUN_GATE)", () => {
  it("daemon rejects fabricated pending_id with MISSING_DRYRUN_GATE, emits 7-key REJECTION audit row, dispatches zero plugin commands", async () => {
    const daemon = await bootDaemon();
    const bridge = new MockPluginBridge();
    if (typeof daemon.attachPluginBridge !== "function") {
      throw new Error("daemon.attachPluginBridge not implemented (W2 pending)");
    }
    daemon.attachPluginBridge(bridge);

    if (typeof daemon.applyApprovedWrite !== "function") {
      throw new Error("daemon.applyApprovedWrite not implemented (W2 pending)");
    }

    const result = await daemon.applyApprovedWrite({
      pending_id: "pw-fabricated-99",
      source_hash_recomputed:
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(result.error).toBe("MISSING_DRYRUN_GATE");

    // Zero plugin command dispatch.
    expect(bridge.snapshot().callCount).toBe(0);

    // 7-key rejection audit row.
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const rejectionRows = audits.filter(
      (a) => a.status === "rejected" && a.reason === "MISSING_DRYRUN_GATE",
    );
    expect(rejectionRows.length).toBe(1);
    expect(Object.keys(rejectionRows[0]).sort()).toEqual(
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

    // applied_writes resource length unchanged at 0.
    if (typeof daemon.readAppliedWrites === "function") {
      expect(daemon.readAppliedWrites().length).toBe(0);
    }

    await daemon.shutdown();
  });
});
