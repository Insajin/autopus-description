// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit helper for frame_name.
// Mirrors the executor-side `${original} · ${screen_id}` rename pattern.
// `originalName` is sourced from ctx.frameNodeName (looked up by the daemon
// before plan-emit) and falls back to a stable token; the executor mode
// reads it live from the figma client at apply time, but plan-emit is
// pre-execution and must serialize a value the plugin can compare.

import type { ManifestEntry } from "../types.js";
import type { PlanEmitContext, PluginCommand } from "./types.js";

// @AX:NOTE [AUTO] U+00B7 middot separator — must match executor-side rename pattern; ASCII-equivalent fallback would diverge plugin/executor parity.
const FRAME_NAME_SEPARATOR = " · ";

export function planFrameName(
  entry: ManifestEntry,
  ctx: PlanEmitContext,
): readonly PluginCommand[] {
  const originalName = ctx.frameNodeName ?? "";
  const renamed = originalName.length > 0
    ? `${originalName}${FRAME_NAME_SEPARATOR}${entry.screen_id}`
    : entry.screen_id;
  const cmd: PluginCommand = {
    op: "set_frame_name",
    args: {
      nodeId: entry.frame_id,
      name: renamed,
      originalName,
    },
  };
  return [cmd];
}
