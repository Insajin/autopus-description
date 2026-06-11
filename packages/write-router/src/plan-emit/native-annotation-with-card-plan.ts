// SPEC-FIGMA-020 T6 — plan-emit helper for the composite `native_annotation_with_card`
// target (REQ-02, REQ-12, REQ-13).
//
// Two-surface decomposition in ONE apply: exactly ONE NATIVE annotation op is
// emitted FIRST (the authoritative frame-level summary), THEN exactly ONE
// structured-table card op `set_policy_card` is appended. Native ALWAYS precedes
// the card op (INV-01, REQ-02): the native annotation is committed first and is
// authoritative; the card is the retryable secondary surface.
//
// SPEC-FIGMA-020 live fix (2026-06-10): the composite native surface is a SINGLE
// frame summary, NOT one annotation per area. Figma's native annotation primitive
// REPLACES (does not append) when multiple annotations target the same node, so a
// per-area fan-out (all areas resolve to the frame node in plan-emit, which has no
// live scan) collapsed to only the LAST area surviving on the live canvas. The
// per-area description+policy detail is fully carried by the card's
// `area_annotations` table (REQ-04), so the native surface stays the concise frame
// summary per locked decision D1.
//
// The card op literal `set_policy_card` is lexically distinct from both
// `set_annotation` (the card 3-step decomposition, byte-unchanged per REQ-12) and
// `set_native_annotation` (the native op). This module NEVER imports or touches
// annotation-card-plan.ts, so the AC-S8 rollback invariant on that path is
// untouched (S8). The card payload is the pure column-mapped table set from
// `buildCardTablePayload`, whose shape matches what the plugin dispatcher (T7) and
// the renderer `createPolicyCardCanvas` consume: `{ frameId; tables: { section;
// header[]; rows[][] }[] }`.

import type { AreaAnnotation, ManifestEntry } from "../types.js";
import { buildCardTablePayload } from "../card-table-payload.js";
import {
  composeAreaLabelSimple,
  composeFrameLabel,
  truncateLabel,
} from "../native-label.js";
import type {
  PlanEmitContext,
  PluginCommand,
  SetNativeAnnotationArgs,
  SetPolicyCardArgs,
} from "./types.js";

// Parity with native-annotation-plan.ts LABEL_BUDGET and the adapter
// (adapters/native-annotation.ts LABEL_BUDGET) so all native labels truncate
// identically (REQ-10).
const LABEL_BUDGET = 500;

function nativeCmd(nodeId: string, labelMarkdown: string): PluginCommand {
  const args: SetNativeAnnotationArgs = { nodeId, labelMarkdown };
  return { op: "set_native_annotation", args };
}

// SPEC-FIGMA-020 live model (2026-06-11): one SHORT native annotation per UI
// element (badge replacement), each anchored to the element's own node via
// area.target_node_id, so distinct-node annotations coexist instead of
// overwriting on the frame. Detailed policy/states/data live in the card.
function nativeAreaCommands(entry: ManifestEntry): PluginCommand[] {
  const areas: AreaAnnotation[] = entry.area_annotations ?? [];
  if (areas.length === 0) {
    // No areas → fall back to a single frame-level summary on the frame node.
    return [nativeCmd(entry.frame_id, truncateLabel(composeFrameLabel(entry), LABEL_BUDGET))];
  }
  return areas.map((area) =>
    nativeCmd(
      area.target_node_id && area.target_node_id.trim().length > 0
        ? area.target_node_id.trim()
        : entry.frame_id,
      truncateLabel(composeAreaLabelSimple(area), LABEL_BUDGET),
    ),
  );
}

function cardCommand(entry: ManifestEntry): PluginCommand {
  const args: SetPolicyCardArgs = {
    frameId: entry.frame_id,
    tables: buildCardTablePayload(entry).tables,
  };
  return { op: "set_policy_card", args };
}

export function planNativeAnnotationWithCard(
  entry: ManifestEntry,
  _ctx: PlanEmitContext,
): readonly PluginCommand[] {
  // Per-element native ops first (authoritative), card op last (retryable
  // secondary). The ordering is the observable INV-01 invariant the dispatcher
  // and daemon rely on.
  return [...nativeAreaCommands(entry), cardCommand(entry)];
}
