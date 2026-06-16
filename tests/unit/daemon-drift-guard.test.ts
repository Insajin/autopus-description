// SPEC-FIGMA-007 W2 unit test — daemon drift guard (REQ-05, REQ-12).
// Asserts: hash mismatch → APPLY_DRIFT_ABORT, zero plugin command dispatch,
// 9-key audit row emitted with both source_hash_dryrun and source_hash_recomputed.

import { describe, it, expect } from "vitest";

import { applyApprovedWrite } from "../../src/daemon/apply-tool.js";
import { PendingWriteStore } from "../../src/daemon/pending-writes.js";
import { DaemonUndoRegistry } from "../../src/daemon/daemon-undo-registry.js";
import { WriteMcpResources } from "../../src/daemon/write-mcp-resources.js";
import { IdempotencyTracker } from "../../packages/write-router/src/idempotency.js";
import type { PluginCommand } from "../../packages/write-router/src/plan-emit/types.js";

interface BridgeStub {
  dispatchCommand: (
    cmd: PluginCommand,
    pendingId?: string,
  ) => Promise<{ ok: boolean; node_ids?: string[]; error?: string }>;
  callCount: number;
}

function makeBridge(): BridgeStub {
  const calls: { cmd: PluginCommand; pendingId?: string }[] = [];
  return {
    dispatchCommand: async (cmd, pendingId) => {
      calls.push({ cmd, pendingId });
      return { ok: true, node_ids: ["7:1"] };
    },
    get callCount() {
      return calls.length;
    },
  };
}

function makeDeps(bridge: BridgeStub) {
  const store = new PendingWriteStore();
  const undoRegistry = new DaemonUndoRegistry();
  const resources = new WriteMcpResources(store);
  const idempotency = new IdempotencyTracker();
  const auditEvents: Array<Record<string, unknown>> = [];
  const pendingForReplay = new Map<
    string,
    { commands: PluginCommand[]; pending: ReturnType<PendingWriteStore["put"]> }
  >();
  return {
    store,
    bridge,
    idempotency,
    undoRegistry,
    resources,
    auditEvents,
    pendingForReplay,
  };
}

const HASH_A =
  "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420";
const HASH_B =
  "4d37393b6c1f9b3a7e8d5c4f2a1e9b6d0c8a3f5e2d7b4c9a1f6e3b8d5c2a7f0e";

describe("daemon drift guard — apply-tool REQ-05 / REQ-12", () => {
  it("source_hash_recomputed mismatch returns APPLY_DRIFT_ABORT and dispatches zero commands", async () => {
    const bridge = makeBridge();
    const deps = makeDeps(bridge);
    const pending = deps.store.put({
      manifest_entry_hash: "h".repeat(64),
      source_hash_dryrun: HASH_A,
      plugin_commands: [{ op: "set_annotation_card", args: { node_id: "1:1" } }],
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    const result = await applyApprovedWrite(deps, {
      pending_id: pending.pending_id,
      source_hash_recomputed: HASH_B,
    });

    expect(result).toMatchObject({
      error: "APPLY_DRIFT_ABORT",
      source_hash_dryrun: HASH_A,
      source_hash_recomputed: HASH_B,
    });
    expect(bridge.callCount).toBe(0);
  });

  it("emits exactly one 9-key drift-abort audit row with status='rejected', reason='APPLY_DRIFT_ABORT'", async () => {
    const bridge = makeBridge();
    const deps = makeDeps(bridge);
    const pending = deps.store.put({
      manifest_entry_hash: "h".repeat(64),
      source_hash_dryrun: HASH_A,
      plugin_commands: [{ op: "set_annotation_card", args: { node_id: "1:1" } }],
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    await applyApprovedWrite(deps, {
      pending_id: pending.pending_id,
      source_hash_recomputed: HASH_B,
    });

    const driftRows = deps.auditEvents.filter(
      (e) => e.reason === "APPLY_DRIFT_ABORT",
    );
    expect(driftRows.length).toBe(1);
    const row = driftRows[0];
    expect(Object.keys(row).sort()).toEqual(
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
    expect(row.status).toBe("rejected");
    expect(row.source_hash_dryrun).toBe(HASH_A);
    expect(row.source_hash_recomputed).toBe(HASH_B);
  });

  it("matching source_hash_recomputed allows apply through (no drift abort row)", async () => {
    const bridge = makeBridge();
    const deps = makeDeps(bridge);
    const pending = deps.store.put({
      manifest_entry_hash: "h".repeat(64),
      source_hash_dryrun: HASH_A,
      plugin_commands: [{ op: "set_annotation_card", args: { node_id: "1:1" } }],
      frame_id: "1:1",
      write_target: "annotation_card",
      undo_template: { type: "delete-node", node_id: "7:42" },
    });

    const result = await applyApprovedWrite(deps, {
      pending_id: pending.pending_id,
      source_hash_recomputed: HASH_A,
    });

    expect((result as { status?: string }).status).toBe("applied");
    expect(bridge.callCount).toBeGreaterThanOrEqual(1);
    expect(
      deps.auditEvents.filter((e) => e.reason === "APPLY_DRIFT_ABORT").length,
    ).toBe(0);
  });

  it("byte-equal source_hash comparison is strict (case-sensitive)", async () => {
    // Lower-case vs upper-case hash MUST be treated as drift.
    const bridge = makeBridge();
    const deps = makeDeps(bridge);
    const pending = deps.store.put({
      manifest_entry_hash: "h".repeat(64),
      source_hash_dryrun: HASH_A,
      plugin_commands: [{ op: "noop", args: {} }],
      frame_id: "1:1",
      write_target: "annotation_card",
    });

    const result = await applyApprovedWrite(deps, {
      pending_id: pending.pending_id,
      source_hash_recomputed: HASH_A.toUpperCase(),
    });

    expect((result as { error?: string }).error).toBe("APPLY_DRIFT_ABORT");
  });
});
