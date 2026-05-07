// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit helper for plugin_data.
// Reuses the `description_${screen_id}` key prefix from
// adapters/plugin-data.ts so the plugin's setPluginData call produces the
// byte-equal pluginData entry that the executor mode would produce.

import type { ManifestEntry } from "../types.js";
import type { PluginCommand } from "./types.js";

// @AX:NOTE [AUTO] frozen magic prefix shared with adapters/plugin-data.ts and undo dispatcher's clear-plugin-data template. Drift here breaks byte-equal pluginData parity (NFR-04).
const PLUGIN_DATA_KEY_PREFIX = "description_";

function pluginDataKeyFor(entry: ManifestEntry): string {
  return `${PLUGIN_DATA_KEY_PREFIX}${entry.screen_id}`;
}

function renderPluginDataValue(entry: ManifestEntry): string {
  return JSON.stringify({
    title: entry.title,
    intent: entry.intent,
    user_value: entry.user_value,
    success_criteria: entry.success_criteria,
  });
}

export function planPluginData(
  entry: ManifestEntry,
): readonly PluginCommand[] {
  const cmd: PluginCommand = {
    op: "set_plugin_data",
    args: {
      nodeId: entry.frame_id,
      key: pluginDataKeyFor(entry),
      value: renderPluginDataValue(entry),
    },
  };
  return [cmd];
}
