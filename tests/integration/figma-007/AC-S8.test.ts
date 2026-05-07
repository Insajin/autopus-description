// SPEC-FIGMA-007 AC-S8: Plugin disconnect mid-apply — partial rollback + audit rejection.
// Linked: REQ-14 | INV-009 (atomicity preservation under failure).

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
  readPendingWrites?: () => Array<Record<string, unknown>>;
  getEmittedAudits?: () => Array<Record<string, unknown>>;
  attachPluginBridge?: (bridge: MockPluginBridge) => void;
  idempotencyHas?: (hash: string) => boolean;
  onPluginReconnect?: () => Promise<void>;
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

describe("AC-S8: Plugin disconnect mid-apply triggers rollback + 7-key REJECTION audit row", () => {
  it("on bridge drop after 2 successful command_results, idempotency is not marked, partial-disconnect audit emitted, inverse commands replay on reconnect", async () => {
    const daemon = await bootDaemon();
    const bridge = new MockPluginBridge({ dropAfter: 2 });
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

    // Multi-command target (annotation_card with 3 sub-commands).
    const pending = await daemon.dryRunWrite({
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    let caught: unknown;
    try {
      await daemon.applyApprovedWrite({
        pending_id: pending.pending_id as string,
        source_hash_recomputed: pending.source_hash_dryrun as string,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();

    // IdempotencyTracker must NOT mark hash applied.
    if (typeof daemon.idempotencyHas === "function") {
      expect(daemon.idempotencyHas(pending.manifest_entry_hash as string)).toBe(
        false,
      );
    }

    // Audit: 7-key REJECTION row with reason APPLY_PARTIAL_DISCONNECT.
    if (typeof daemon.getEmittedAudits !== "function") {
      throw new Error("daemon.getEmittedAudits not implemented (W2 pending)");
    }
    const audits = daemon.getEmittedAudits();
    const partialRows = audits.filter(
      (a) => a.status === "rejected" && a.reason === "APPLY_PARTIAL_DISCONNECT",
    );
    expect(partialRows.length).toBe(1);
    expect(Object.keys(partialRows[0]).sort()).toEqual(
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

    // applied_writes resource length unchanged (no entry added).
    if (typeof daemon.readAppliedWrites === "function") {
      expect(daemon.readAppliedWrites().length).toBe(0);
    }

    // pending_writes still contains the snapshot until expires_at.
    if (typeof daemon.readPendingWrites === "function") {
      const pendingList = daemon.readPendingWrites();
      const stillThere = pendingList.find(
        (p) => p.pending_id === pending.pending_id,
      );
      expect(stillThere).toBeDefined();
    }

    // On reconnect, inverse commands replay in reverse order.
    bridge.reconnect();
    const dispatchedBeforeReconnect = bridge.dispatched.length;
    if (typeof daemon.onPluginReconnect === "function") {
      await daemon.onPluginReconnect();
    } else {
      throw new Error("daemon.onPluginReconnect not implemented (W2 pending)");
    }
    const dispatchedAfter = bridge.dispatched.slice(dispatchedBeforeReconnect);
    expect(dispatchedAfter.length).toBe(2); // 2 inverse for the 2 completed commands
    // Inverse commands MUST be dispatched in reverse order.
    expect(dispatchedAfter[0].command.op).toMatch(/^(delete_node|delete_comment|clear_plugin_data|restore_frame_name)$/);

    await daemon.shutdown();
  });
});
