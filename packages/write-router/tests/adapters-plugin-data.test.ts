// SPEC-FIGMA-004 W2 unit — plugin_data adapter (REQ-04(d), REQ-06, INV-006).

import { describe, it, expect } from "vitest";

import {
  applyPluginData,
  undoPluginData,
  pluginDataKeyFor,
  PLUGIN_DATA_KEY_PREFIX,
} from "@autopus/write-router/adapters/plugin-data";
import type { ManifestEntry } from "@autopus/write-router/types";

interface SetCall {
  nodeId: string;
  key: string;
  value: string;
}
interface ClearCall {
  nodeId: string;
  key: string;
}

function makeClient() {
  const calls = {
    setPluginData: [] as SetCall[],
    clearPluginData: [] as ClearCall[],
  };
  return {
    calls,
    async setPluginData(args: SetCall) {
      calls.setPluginData.push(args);
    },
    async clearPluginData(args: ClearCall) {
      calls.clearPluginData.push(args);
    },
  };
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "node-7",
    title: "로그인",
    intent: "사용자 인증 게이트",
    user_value: "v",
    success_criteria: "s",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "h",
    write_target: "plugin_data",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

describe("plugin_data adapter", () => {
  it("derives a screen-scoped key and writes intent via setPluginData", async () => {
    const client = makeClient();
    const entry = makeEntry();

    const result = await applyPluginData(entry, { figma: client });

    expect(pluginDataKeyFor(entry)).toBe(`${PLUGIN_DATA_KEY_PREFIX}AUTH-01`);
    expect(client.calls.setPluginData).toHaveLength(1);
    expect(client.calls.setPluginData[0]).toEqual({
      nodeId: "node-7",
      key: "description_AUTH-01",
      value: "사용자 인증 게이트",
    });
    expect(result.undo_descriptor).toEqual({
      type: "clear-plugin-data",
      node_id: "node-7",
      key: "description_AUTH-01",
    });
    expect(result.fallback_used).toBe(true);
  });

  it("undo clears the same node/key pair", async () => {
    const client = makeClient();
    const entry = makeEntry({ frame_id: "node-9", screen_id: "DASH-02" });

    const result = await applyPluginData(entry, { figma: client });
    await undoPluginData(result.undo_descriptor, { figma: client });

    expect(client.calls.clearPluginData).toEqual([
      { nodeId: "node-9", key: "description_DASH-02" },
    ]);
  });

  it("rejects when client is missing required methods", async () => {
    const broken = { setPluginData: 1 } as unknown;
    const err = await applyPluginData(makeEntry(), { figma: broken }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("WRITE_TARGET_ROUTING_ERROR");
  });
});
