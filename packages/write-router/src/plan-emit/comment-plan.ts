// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit helper for comment.
// Resolution order: explicit ctx.fileKey → entry.figma_file_key → "default".
// SEC-007-L1: env fallback intentionally NOT consulted in plan-emit. The
// resulting plugin_commands[] are published over the autopus://pending_writes
// MCP resource, so env-derived secrets must not leak through this path.
// Frozen executor adapter (NFR-04) keeps its env fallback for back-compat.

import type { ManifestEntry } from "../types.js";
import type { PlanEmitContext, PluginCommand } from "./types.js";

const DEFAULT_FILE_KEY = "default";

function resolveFileKey(entry: ManifestEntry, ctx: PlanEmitContext): string {
  if (ctx.fileKey && ctx.fileKey.length > 0) return ctx.fileKey;
  const fromEntry = (entry as { figma_file_key?: unknown }).figma_file_key;
  if (typeof fromEntry === "string" && fromEntry.length > 0) return fromEntry;
  return DEFAULT_FILE_KEY;
}

function renderCommentText(entry: ManifestEntry): string {
  return `[${entry.screen_id}] ${entry.title}\n${entry.intent}`;
}

export function planComment(
  entry: ManifestEntry,
  ctx: PlanEmitContext,
): readonly PluginCommand[] {
  const cmd: PluginCommand = {
    op: "post_comment",
    args: {
      fileKey: resolveFileKey(entry, ctx),
      frameId: entry.frame_id,
      text: renderCommentText(entry),
    },
  };
  return [cmd];
}
