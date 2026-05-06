// SPEC-FIGMA-004 W2 — plugin_data adapter (REQ-04(d), REQ-06, INV-006).
//
// Plugin Bridge is the ONLY transport for setPluginData; the official Figma
// MCP cannot invoke setPluginData (spec.md § 4). Therefore fallback_used is
// always true on the apply path even though no MCP attempt precedes it.
//
// Key naming: a stable per-screen key keeps multiple manifest entries on the
// same frame_id from clobbering each other. Format: `description_${screen_id}`.

import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";

export const PLUGIN_DATA_KEY_PREFIX = "description_";

interface PluginBridgeClient {
  setPluginData(args: {
    nodeId: string;
    key: string;
    value: string;
  }): Promise<void>;
  clearPluginData(args: { nodeId: string; key: string }): Promise<void>;
}

function asClient(figma: unknown): PluginBridgeClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "plugin_data adapter requires a Plugin Bridge client",
    );
  }
  const candidate = figma as Partial<PluginBridgeClient>;
  if (
    typeof candidate.setPluginData !== "function" ||
    typeof candidate.clearPluginData !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "plugin_data client missing required methods",
    );
  }
  return candidate as PluginBridgeClient;
}

export function pluginDataKeyFor(entry: ManifestEntry): string {
  return `${PLUGIN_DATA_KEY_PREFIX}${entry.screen_id}`;
}

export async function applyPluginData(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  const client = asClient(ctx.figma);
  const key = pluginDataKeyFor(entry);
  await client.setPluginData({
    nodeId: entry.frame_id,
    key,
    value: entry.intent,
  });
  const undo_descriptor: UndoDescriptor = {
    type: "clear-plugin-data",
    node_id: entry.frame_id,
    key,
  };
  return { undo_descriptor, node_id: entry.frame_id, fallback_used: true };
}

export async function undoPluginData(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "clear-plugin-data") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `plugin_data undo expected clear-plugin-data, got ${descriptor.type}`,
    );
  }
  const client = asClient(ctx.figma);
  await client.clearPluginData({
    nodeId: descriptor.node_id,
    key: descriptor.key,
  });
}

export const pluginDataAdapter: Adapter = {
  apply: applyPluginData,
  undo: undoPluginData,
};
