// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit helper for none target.
// Broadcast-only path: zero Figma mutation, single noop command so AC-S1's
// `plugin_commands.length >= 1` invariant still holds.

import type { ManifestEntry } from "../types.js";
import type { PluginCommand } from "./types.js";

export function planNone(_entry: ManifestEntry): readonly PluginCommand[] {
  const cmd: PluginCommand = { op: "noop", args: {} };
  return [cmd];
}
