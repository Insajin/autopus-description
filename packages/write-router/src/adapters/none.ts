// SPEC-FIGMA-004 W2 — none adapter (REQ-04(f)).
// Broadcast-only path. The router records the manifest entry's apply event
// in the audit log but invokes ZERO Figma write APIs. Reversibility is
// trivial — no canvas state changed, so undo is a noop.

import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";

export async function applyNone(
  _entry: ManifestEntry,
  _ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  const undo_descriptor: UndoDescriptor = { type: "noop" };
  return { undo_descriptor, fallback_used: false };
}

export async function undoNone(
  _descriptor: UndoDescriptor,
  _ctx: AdapterContext,
): Promise<void> {
  /* no Figma write to undo */
}

export const noneAdapter: Adapter = {
  apply: applyNone,
  undo: undoNone,
};
