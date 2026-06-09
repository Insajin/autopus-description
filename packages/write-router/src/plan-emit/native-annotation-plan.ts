// SPEC-FIGMA-018 T5 — plan-emit helper for native_annotation (REQ-02, REQ-03).
//
// Single-step decomposition: one `set_native_annotation` plugin command per
// resolved node. This is deliberately distinct from the card's fixed 3-step
// `set_annotation` decomposition (annotation-card-plan.ts), so the AC-S8
// rollback invariant on the card path is never touched (S12). The new op name
// `set_native_annotation` is never `set_annotation` (S10 naming-collision).
//
// Label composition reuses the T2 composers and node resolution reuses the T3
// resolver so plan-emit parity with the adapter (T4) is structural, not copied.

import type { AreaAnnotation, ManifestEntry } from "../types.js";
import {
  composeAreaLabel,
  composeFrameLabel,
  truncateLabel,
} from "../native-label.js";
import { resolveAreaNode } from "../area-node-resolver.js";
import type { PluginCommand, SetNativeAnnotationArgs } from "./types.js";

// @AX:NOTE [AUTO]: magic constant — must stay equal to adapters/native-annotation.ts LABEL_BUDGET, else plan-emit and adapter truncate labels differently and break parity (REQ-10).
// REQ-10 — conservative native annotation label budget; matches the adapter
// (adapters/native-annotation.ts LABEL_BUDGET) for parity.
const LABEL_BUDGET = 500;

// Plan-emit runs without a live scan, so the only node name available is the
// frame node itself. Areas that do not name a known node resolve to the frame
// node via the resolver's fallback path, exactly as the adapter would.
export interface NativeAnnotationPlanContext {
  frameNodeName?: string;
}

function resolveCategoryId(area: AreaAnnotation): string | undefined {
  const raw = (area as unknown as Record<string, unknown>).category_id;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function command(args: SetNativeAnnotationArgs): PluginCommand {
  return { op: "set_native_annotation", args };
}

export function planNativeAnnotation(
  entry: ManifestEntry,
  ctx: NativeAnnotationPlanContext,
): readonly PluginCommand[] {
  // Single-entry index: frame node name → frame id. The resolver falls back to
  // the frame node for any area whose target_area/placement_hint does not match.
  const nodeIndex: Record<string, string> = {};
  if (ctx.frameNodeName && ctx.frameNodeName.trim().length > 0) {
    nodeIndex[ctx.frameNodeName] = entry.frame_id;
  }

  const areas = entry.area_annotations ?? [];
  if (areas.length === 0) {
    return [
      command({
        nodeId: entry.frame_id,
        labelMarkdown: truncateLabel(composeFrameLabel(entry), LABEL_BUDGET),
      }),
    ];
  }

  return areas.map((area) => {
    const resolution = resolveAreaNode(area, entry.frame_id, nodeIndex);
    const categoryId = resolveCategoryId(area);
    return command({
      nodeId: resolution.node_id,
      labelMarkdown: truncateLabel(composeAreaLabel(area), LABEL_BUDGET),
      ...(categoryId ? { categoryId } : {}),
    });
  });
}
