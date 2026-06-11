// SPEC-FIGMA-021 S7 — the compound native-with-card undo executes BOTH inverse
// surfaces against the live adapter: card delete (delete_node → node.remove) and
// native restore (restore_annotation → node.annotations write-back). Empty prior
// clears annotations to []. No command returns unknown_inverse_op:restore_annotation.

import { describe, expect, it } from "vitest";

import { createAutopusPluginAdapter } from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_plugin_adapter.js";
import { dispatchPluginCommand } from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.js";
import { undoWrite } from "../../src/daemon/undo-tool.js";
import type { UndoDescriptor } from "../../packages/write-router/src/types.js";
import type { DaemonUndoRegistry } from "../../src/daemon/daemon-undo-registry.js";

interface StubNode {
  id: string;
  annotations: Array<{ labelMarkdown: string; categoryId?: string }>;
  remove(): void;
}

function makeStub() {
  const nodes = new Map<string, StubNode>();
  const add = (id: string) => {
    const node: StubNode = {
      id,
      annotations: [],
      remove() {
        nodes.delete(id);
      },
    };
    nodes.set(id, node);
    return node;
  };
  const figma = {
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
  };
  return { figma, nodes, add };
}

describe("autopus compound undo inverse (S7)", () => {
  it("deletes the card node and restores the prior native annotation", async () => {
    const { figma, nodes, add } = makeStub();
    const card_id = "card-1";
    const anno_id = "80:1";
    add(card_id);
    const anno = add(anno_id);
    const adapter = createAutopusPluginAdapter(figma);

    // Ordered compound inverse: card delete first, native restore second.
    const del = await dispatchPluginCommand(adapter, {
      op: "delete_node",
      args: { node_id: card_id },
    });
    expect(del.ok).toBe(true);
    expect(await figma.getNodeByIdAsync(card_id)).toBeNull();

    const restore = await dispatchPluginCommand(adapter, {
      op: "restore_annotation",
      args: { node_id: anno_id, prior: [{ labelMarkdown: "**prev**" }] },
    });
    expect(restore.ok).toBe(true);
    expect(restore.error ?? "").not.toContain("unknown_inverse_op:restore_annotation");
    expect(anno.annotations).toEqual([{ labelMarkdown: "**prev**" }]);
    expect(nodes.has(card_id)).toBe(false);
  });

  it("two-area compound undo emits [card delete-node, native restore×2] in that order", async () => {
    // Oracle for natives.length === 2: 2 distinct target_node_id → 2 set_native_annotation
    // ops → the hydrated descriptor has natives[0].node_id="elem-10:1", natives[1].node_id="elem-10:2",
    // card.node_id="card-99". One undo emits card delete first, then two native restores.
    const { figma, nodes, add } = makeStub();
    add("card-99");
    const elem1 = add("elem-10:1");
    const elem2 = add("elem-10:2");
    elem1.annotations = [{ labelMarkdown: "prior1" }];
    elem2.annotations = [{ labelMarkdown: "prior2" }];

    const descriptor: Extract<UndoDescriptor, { type: "native-with-card" }> = {
      type: "native-with-card",
      natives: [
        { type: "restore-annotation", node_id: "elem-10:1", prior: [{ labelMarkdown: "prev1" }] },
        { type: "restore-annotation", node_id: "elem-10:2", prior: [{ labelMarkdown: "prev2" }] },
      ],
      card: { type: "delete-node", node_id: "card-99" },
    };

    // Collect inverse commands via a recording bridge.
    const ops: Array<{ op: string; args: Record<string, unknown> }> = [];
    const recordingBridge = {
      dispatchCommand: async (cmd: { op: string; args: Record<string, unknown> }) => {
        ops.push(cmd);
      },
    };

    const mockRegistry = {
      get: (_id: string) => ({
        write_id: "w-1",
        manifest_entry_hash: "hash-1",
        frame_id: "10:0",
        write_target: "native_annotation_with_card" as const,
        descriptor,
        applied_at: "",
      }),
      remove: (_id: string) => {},
    } as unknown as DaemonUndoRegistry;

    const mockIdempotency = {
      has: () => false,
      clear: () => {},
      record: () => {},
    };

    const result = await undoWrite(
      {
        bridge: recordingBridge as never,
        idempotency: mockIdempotency as never,
        undoRegistry: mockRegistry as never,
        resources: { removeApplied: () => {} } as never,
        auditEvents: [],
      },
      { write_id: "w-1" },
    );

    expect("status" in result && result.status).toBe("undone");
    // ORDER: card delete_node first, then two restore_annotation ops.
    expect(ops).toHaveLength(3);
    expect(ops[0].op).toBe("delete_node");
    expect(ops[0].args["node_id"]).toBe("card-99");
    expect(ops[1].op).toBe("restore_annotation");
    expect(ops[1].args["node_id"]).toBe("elem-10:1");
    expect(ops[2].op).toBe("restore_annotation");
    expect(ops[2].args["node_id"]).toBe("elem-10:2");

    // Also verify that the hydration oracle: 3 nodeIds → natives[0],[1] and card.
    // (This is the hydrateUndoDescriptor oracle tested in apply-undo-descriptor.test.ts;
    //  here we just confirm the descriptor shape fed to undoWrite is well-formed.)
    expect(descriptor.natives).toHaveLength(2);
    expect(descriptor.card.node_id).toBe("card-99");

    void figma; void nodes; void elem1; void elem2;
  });

  it("clears annotations to [] when the prior snapshot is empty", async () => {
    const { figma, add } = makeStub();
    const anno_id = "81:1";
    const anno = add(anno_id);
    anno.annotations = [{ labelMarkdown: "stale" }];
    const adapter = createAutopusPluginAdapter(figma);

    const restore = await dispatchPluginCommand(adapter, {
      op: "restore_annotation",
      args: { node_id: anno_id, prior: [] },
    });

    expect(restore.ok).toBe(true);
    expect(restore.error ?? "").not.toContain("unknown_inverse_op:restore_annotation");
    expect(anno.annotations).toEqual([]);
  });
});
