import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyViaPluginBridge,
  setPluginBridgeTransport,
} from "../src/fallback/plugin-bridge.js";
import type {
  ManifestEntry,
} from "../src/types.js";

function entry(): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증",
    user_value: "PM",
    success_criteria: "5초",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abcd1234",
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

afterEach(() => {
  setPluginBridgeTransport(null);
});

describe("applyViaPluginBridge (REQ-06 / INV-006)", () => {
  it("default transport returns a synthetic node id with delete-node undo", async () => {
    const result = await applyViaPluginBridge(entry(), {
      fallback_reason: "MCP_PERMISSION_ERROR",
    });
    expect(result.status).toBe("applied");
    expect(result.fallback_used).toBe(true);
    expect(result.undo_descriptor).toEqual({
      type: "delete-node",
      node_id: "bridge-1:1",
    });
    expect(result.write_id).toMatch(/^wb-/);
  });

  it("uses an injected transport when set", async () => {
    const transport = {
      send: vi.fn(async () => ({
        nodeId: "node-injected-1",
        undo_descriptor: {
          type: "delete-node" as const,
          node_id: "node-injected-1",
        },
      })),
    };
    setPluginBridgeTransport(transport);
    const result = await applyViaPluginBridge(entry(), {
      fallback_reason: "MCP_PERMISSION_ERROR",
    });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(result.node_id).toBe("node-injected-1");
  });

  it("preserves transport-supplied undo_descriptor verbatim", async () => {
    const transport = {
      send: vi.fn(async () => ({
        nodeId: "node-x",
        undo_descriptor: { type: "delete-node" as const, node_id: "node-x" },
      })),
    };
    setPluginBridgeTransport(transport);
    const result = await applyViaPluginBridge(entry(), {
      fallback_reason: "MCP_PERMISSION_ERROR",
    });
    expect(result.undo_descriptor).toEqual({
      type: "delete-node",
      node_id: "node-x",
    });
  });

  it("falls back to delete-node descriptor synthesized from nodeId when transport omits one", async () => {
    const transport = {
      send: vi.fn(async () => ({ nodeId: "node-only" })),
    };
    setPluginBridgeTransport(transport);
    const result = await applyViaPluginBridge(entry(), {
      fallback_reason: "MCP_PERMISSION_ERROR",
    });
    expect(result.undo_descriptor).toEqual({
      type: "delete-node",
      node_id: "node-only",
    });
  });
});
