// SPEC-FIGMA-021 S7 — the compound native-with-card undo executes BOTH inverse
// surfaces against the live adapter: card delete (delete_node → node.remove) and
// native restore (restore_annotation → node.annotations write-back). Empty prior
// clears annotations to []. No command returns unknown_inverse_op:restore_annotation.

import { describe, expect, it } from "vitest";

import { createAutopusPluginAdapter } from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_plugin_adapter.js";
import { dispatchPluginCommand } from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_command_dispatch.js";

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
