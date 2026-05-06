// SPEC-FIGMA-004 W2 — comment adapter (REQ-04(c), REQ-08, INV-002, INV-003).
// Posts a Figma comment on the target frame via REST.
// Reversibility: DELETE the comment by id.
//
// Note: there is no Plugin Bridge fallback for comments — the Figma plugin
// runtime cannot create REST comments. If the REST surface is unavailable,
// the adapter throws and the router surfaces the error to the PM rather
// than silently swallowing the write (spec.md § 4 footnote).

import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";

interface CommentClient {
  commentPost(args: {
    fileKey: string;
    frameId: string;
    text: string;
  }): Promise<{ commentId: string }>;
  deleteComment(args: {
    fileKey: string;
    commentId: string;
  }): Promise<void>;
}

function asClient(figma: unknown): CommentClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "comment adapter requires a Figma write client",
    );
  }
  const candidate = figma as Partial<CommentClient>;
  if (
    typeof candidate.commentPost !== "function" ||
    typeof candidate.deleteComment !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "comment client missing required methods",
    );
  }
  return candidate as CommentClient;
}

// Default file key used when no override is supplied. Production callers
// SHOULD set FIGMA_FILE_KEY (or pass ctx.fileKey / entry.figma_file_key) to
// target the correct Figma file; the "default" sentinel keeps mock-driven
// tests from needing to pre-set the env var.
function resolveFileKey(entry: ManifestEntry, ctx: AdapterContext): string {
  const ctxKey = (ctx as { fileKey?: unknown }).fileKey;
  if (typeof ctxKey === "string" && ctxKey.length > 0) return ctxKey;
  const fromEntry = (entry as { figma_file_key?: unknown }).figma_file_key;
  if (typeof fromEntry === "string" && fromEntry.length > 0) return fromEntry;
  const fromEnv = process.env.FIGMA_FILE_KEY;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return "default";
}

function renderCommentText(entry: ManifestEntry): string {
  return `[${entry.screen_id}] ${entry.title}\n${entry.intent}`;
}

export async function applyComment(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  const client = asClient(ctx.figma);
  const fileKey = resolveFileKey(entry, ctx);
  const { commentId } = await client.commentPost({
    fileKey,
    frameId: entry.frame_id,
    text: renderCommentText(entry),
  });
  const undo_descriptor: UndoDescriptor = {
    type: "delete-comment",
    comment_id: commentId,
  };
  return { undo_descriptor, fallback_used: false };
}

export async function undoComment(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "delete-comment") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `comment undo expected delete-comment, got ${descriptor.type}`,
    );
  }
  const client = asClient(ctx.figma);
  const ctxKey = (ctx as { fileKey?: unknown }).fileKey;
  const fileKey =
    typeof ctxKey === "string" && ctxKey.length > 0
      ? ctxKey
      : process.env.FIGMA_FILE_KEY ?? "default";
  await client.deleteComment({ fileKey, commentId: descriptor.comment_id });
}

export const commentAdapter: Adapter = {
  apply: applyComment,
  undo: undoComment,
};
