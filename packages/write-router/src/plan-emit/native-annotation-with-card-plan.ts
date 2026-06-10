// SPEC-FIGMA-020 T6 — plan-emit helper for the composite `native_annotation_with_card`
// target (REQ-02, REQ-12, REQ-13).
//
// Two-surface decomposition in ONE apply: the NATIVE annotation op(s) are emitted
// FIRST by reusing `planNativeAnnotation` unchanged (one `set_native_annotation`
// per resolved node, the authoritative surface), THEN exactly ONE structured-table
// card op `set_policy_card` is appended. Native ALWAYS precedes the card op
// (INV-01, REQ-02): the native annotation is committed first and is authoritative;
// the card is the retryable secondary surface.
//
// The card op literal `set_policy_card` is lexically distinct from both
// `set_annotation` (the card 3-step decomposition, byte-unchanged per REQ-12) and
// `set_native_annotation` (the native op). This module NEVER imports or touches
// annotation-card-plan.ts, so the AC-S8 rollback invariant on that path is
// untouched (S8). The card payload is the pure column-mapped table set from
// `buildCardTablePayload`, whose shape matches what the plugin dispatcher (T7) and
// the renderer `createPolicyCardCanvas` consume: `{ frameId; tables: { section;
// header[]; rows[][] }[] }`.

import type { ManifestEntry } from "../types.js";
import { buildCardTablePayload } from "../card-table-payload.js";
import { planNativeAnnotation } from "./native-annotation-plan.js";
import type {
  PlanEmitContext,
  PluginCommand,
  SetPolicyCardArgs,
} from "./types.js";

function cardCommand(entry: ManifestEntry): PluginCommand {
  const args: SetPolicyCardArgs = {
    frameId: entry.frame_id,
    tables: buildCardTablePayload(entry).tables,
  };
  return { op: "set_policy_card", args };
}

export function planNativeAnnotationWithCard(
  entry: ManifestEntry,
  ctx: PlanEmitContext,
): readonly PluginCommand[] {
  // Native ops first (authoritative), card op last (retryable secondary). The
  // ordering is the observable INV-01 invariant the dispatcher and daemon rely on.
  const nativeCommands = planNativeAnnotation(entry, ctx);
  return [...nativeCommands, cardCommand(entry)];
}
