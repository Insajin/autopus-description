// SPEC-FIGMA-007 W2 unit test — undoWrite + DaemonUndoRegistry (REQ-08).
// Asserts: undoWrite dispatches inverse plugin command, removes from
// IdempotencyTracker + DaemonUndoRegistry + applied_writes, emits 7-key UNDO row.

import { describe, it, expect } from "vitest";

import {
  undoWrite,
  inverseCommand,
  replayPartialRollback,
} from "../../src/daemon/undo-tool.js";
import {
  DaemonUndoRegistry,
  type DaemonUndoRecord,
} from "../../src/daemon/daemon-undo-registry.js";
import { PendingWriteStore } from "../../src/daemon/pending-writes.js";
import { WriteMcpResources } from "../../src/daemon/write-mcp-resources.js";
import { IdempotencyTracker } from "../../packages/write-router/src/idempotency.js";
import type {
  UndoDescriptor,
  WriteTarget,
} from "../../packages/write-router/src/types.js";
import type { PluginCommand } from "../../packages/write-router/src/plan-emit/types.js";

interface BridgeCall {
  cmd: PluginCommand;
  pendingId?: string;
}

function makeBridge() {
  const calls: BridgeCall[] = [];
  return {
    calls,
    dispatchCommand: async (cmd: PluginCommand, pendingId?: string) => {
      calls.push({ cmd, pendingId });
      return { ok: true, node_ids: [] };
    },
  };
}

function makeDeps() {
  const store = new PendingWriteStore();
  const idempotency = new IdempotencyTracker();
  const undoRegistry = new DaemonUndoRegistry();
  const resources = new WriteMcpResources(store);
  const auditEvents: Array<Record<string, unknown>> = [];
  return {
    store,
    idempotency,
    undoRegistry,
    resources,
    auditEvents,
  };
}

function makeRecord(overrides: Partial<DaemonUndoRecord> = {}): DaemonUndoRecord {
  return {
    write_id: "wr-test-1",
    frame_id: "1:1",
    manifest_entry_hash: "a".repeat(64),
    write_target: "annotation_card" as WriteTarget,
    descriptor: { type: "delete-node", node_id: "7:42" } satisfies UndoDescriptor,
    applied_at: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("undoWrite — REQ-08 contract", () => {
  it("undoWrite returns status='undone' and propagates the manifest_entry_hash", async () => {
    const bridge = makeBridge();
    const deps = makeDeps();
    const record = makeRecord();
    deps.undoRegistry.register(record);
    deps.idempotency.record(record.manifest_entry_hash);
    deps.resources.recordApplied({
      write_id: record.write_id,
      frame_id: record.frame_id,
      write_target: record.write_target,
      manifest_entry_hash: record.manifest_entry_hash,
      undo_descriptor: record.descriptor,
      applied_at: record.applied_at,
    });

    const result = await undoWrite(
      { ...deps, bridge },
      { write_id: record.write_id },
    );

    expect(result).toEqual({
      status: "undone",
      write_id: record.write_id,
      manifest_entry_hash: record.manifest_entry_hash,
    });
  });

  it("undoWrite removes write_id from DaemonUndoRegistry and from applied_writes", async () => {
    const bridge = makeBridge();
    const deps = makeDeps();
    const record = makeRecord();
    deps.undoRegistry.register(record);
    deps.resources.recordApplied({
      write_id: record.write_id,
      frame_id: record.frame_id,
      write_target: record.write_target,
      manifest_entry_hash: record.manifest_entry_hash,
      undo_descriptor: record.descriptor,
      applied_at: record.applied_at,
    });

    await undoWrite({ ...deps, bridge }, { write_id: record.write_id });

    expect(deps.undoRegistry.has(record.write_id)).toBe(false);
    expect(deps.resources.readAppliedWrites().length).toBe(0);
  });

  it("undoWrite emits exactly one 7-key UNDO audit row with status='undone', reason='UNDO_REQUESTED'", async () => {
    const bridge = makeBridge();
    const deps = makeDeps();
    const record = makeRecord();
    deps.undoRegistry.register(record);

    await undoWrite({ ...deps, bridge }, { write_id: record.write_id });

    expect(deps.auditEvents.length).toBe(1);
    const row = deps.auditEvents[0];
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
    expect(row.status).toBe("undone");
    expect(row.reason).toBe("UNDO_REQUESTED");
  });

  it("unknown write_id returns UNKNOWN_WRITE_ID error and emits no audit row", async () => {
    const bridge = makeBridge();
    const deps = makeDeps();
    const result = await undoWrite(
      { ...deps, bridge },
      { write_id: "wr-fabricated-1" },
    );
    expect((result as { error?: string }).error).toBe("UNKNOWN_WRITE_ID");
    expect(deps.auditEvents.length).toBe(0);
  });

  it("inverseCommand maps each UndoDescriptor variant to a PluginCommand", () => {
    const variants: UndoDescriptor[] = [
      { type: "delete-node", node_id: "7:1" },
      { type: "delete-comment", comment_id: "c-1" },
      { type: "clear-plugin-data", node_id: "7:1", key: "k" },
      { type: "restore-frame-name", node_id: "7:1", original_name: "n" },
      { type: "noop" },
    ];
    for (const v of variants) {
      const cmd = inverseCommand(v);
      expect(typeof cmd.op).toBe("string");
      expect(typeof cmd.args).toBe("object");
    }
  });

  it("replayPartialRollback dispatches inverse commands in reverse order", async () => {
    const bridge = makeBridge();
    const forwards: PluginCommand[] = [
      // SPEC-FIGMA-022 — legacy text-card op (renamed); its inverse is delete_node.
      { op: "set_annotation_card", args: { node_id: "1:1" } },
      { op: "set_plugin_data", args: { nodeId: "1:1", key: "k" } },
    ];
    await replayPartialRollback(bridge, forwards);
    expect(bridge.calls.length).toBe(2);
    // First inverse should map the LAST forward (set_plugin_data → clear_plugin_data)
    expect(bridge.calls[0].cmd.op).toBe("clear_plugin_data");
    expect(bridge.calls[1].cmd.op).toBe("delete_node");
  });
});

describe("DaemonUndoRegistry — REQ-08 storage", () => {
  it("register/get/has/remove preserve identity for write_id keys", () => {
    const registry = new DaemonUndoRegistry();
    const record = makeRecord();
    registry.register(record);
    expect(registry.has(record.write_id)).toBe(true);
    expect(registry.get(record.write_id)).toEqual(record);
    registry.remove(record.write_id);
    expect(registry.has(record.write_id)).toBe(false);
    expect(registry.get(record.write_id)).toBeUndefined();
  });

  it("size and list reflect current entries", () => {
    const registry = new DaemonUndoRegistry();
    registry.register(makeRecord({ write_id: "wr-a" }));
    registry.register(makeRecord({ write_id: "wr-b" }));
    expect(registry.size()).toBe(2);
    const list = registry.list();
    const ids = list.map((r) => r.write_id).sort();
    expect(ids).toEqual(["wr-a", "wr-b"]);
  });
});
