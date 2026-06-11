// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit dispatcher.
// Resolves the `WriteTarget` to its plan helper and produces a `PlanEmitResult`
// containing `manifest_entry_hash`, `plugin_commands[]`, and an
// `undo_descriptor_template`. The router's `apply(entry, { mode: "plan-emit" })`
// 5-line guard delegates here without touching any Figma write surface.
//
// `undo_descriptor_template` is the static skeleton that the daemon will
// hydrate post-apply with concrete node_ids/comment_ids returned by the plugin.

import { computeManifestEntryHash } from "../idempotency.js";
import type { ManifestEntry, UndoDescriptor, WriteTarget } from "../types.js";
import {
  type PlanEmitContext,
  type PlanEmitResult,
  type PluginCommand,
} from "./types.js";
import { planAnnotationCard } from "./annotation-card-plan.js";
import { planNativeAnnotation } from "./native-annotation-plan.js";
import { planNativeAnnotationWithCard } from "./native-annotation-with-card-plan.js";
import { planDescriptionsPage } from "./descriptions-page-plan.js";
import { planComment } from "./comment-plan.js";
import { planPluginData } from "./plugin-data-plan.js";
import { planFrameName } from "./frame-name-plan.js";
import { planNone } from "./none-plan.js";

// @AX:ANCHOR [AUTO] plan-emit dispatch table — every WriteTarget MUST have a UNDO_TEMPLATE entry; missing keys break AC-S1 7-key oracle and downstream daemon hydration in apply-tool.ts::hydrateUndoDescriptor. Reason: contract surface shared with WriteRouter.apply, dryRunWrite, applyApprovedWrite, undo-tool, and 6+ test sites.
const UNDO_TEMPLATE: Readonly<Record<WriteTarget, UndoDescriptor>> = {
  annotation_card: { type: "delete-node", node_id: "" },
  native_annotation: { type: "restore-annotation", node_id: "", prior: [] },
  // SPEC-FIGMA-020 REQ-08 — compound template reversing BOTH surfaces. `natives`
  // is a 1-element skeleton array (expanded to N in templateFor when the entry has
  // area_annotations); `card` is the `delete-node` placeholder. The daemon hydrates
  // each native member's node_id + prior post-apply, and the card node_id.
  native_annotation_with_card: {
    type: "native-with-card",
    natives: [{ type: "restore-annotation", node_id: "", prior: [] }],
    card: { type: "delete-node", node_id: "" },
  },
  descriptions_page: { type: "delete-node", node_id: "" },
  comment: { type: "delete-comment", comment_id: "" },
  plugin_data: { type: "clear-plugin-data", node_id: "", key: "" },
  frame_name: { type: "restore-frame-name", node_id: "", original_name: "" },
  none: { type: "noop" },
} as const;

function dispatchPlan(
  entry: ManifestEntry,
  ctx: PlanEmitContext,
): readonly PluginCommand[] {
  switch (entry.write_target) {
    case "annotation_card":
      return planAnnotationCard(entry);
    case "native_annotation":
      return planNativeAnnotation(entry, ctx);
    case "native_annotation_with_card":
      return planNativeAnnotationWithCard(entry, ctx);
    case "descriptions_page":
      return planDescriptionsPage(entry);
    case "comment":
      return planComment(entry, ctx);
    case "plugin_data":
      return planPluginData(entry);
    case "frame_name":
      return planFrameName(entry, ctx);
    case "none":
      return planNone(entry);
  }
}

function templateFor(entry: ManifestEntry): UndoDescriptor {
  const tpl = UNDO_TEMPLATE[entry.write_target];
  if (tpl.type === "clear-plugin-data") {
    return {
      type: "clear-plugin-data",
      node_id: entry.frame_id,
      key: `description_${entry.screen_id}`,
    };
  }
  if (tpl.type === "restore-frame-name") {
    return {
      type: "restore-frame-name",
      node_id: entry.frame_id,
      original_name: "",
    };
  }
  // SPEC-FIGMA-020 REQ-08 — deep-copy the compound template so its `natives`/`card`
  // members are not shared references into the frozen UNDO_TEMPLATE skeleton. The
  // `natives` array length is sized to match the number of `set_native_annotation`
  // ops the plan emits: (area_annotations?.length || 1). Each element is an
  // empty-prior `restore-annotation` placeholder; the daemon hydrates node_id + prior
  // for each member post-apply.
  if (tpl.type === "native-with-card") {
    const nativeCount = (entry.area_annotations?.length ?? 0) || 1;
    return {
      type: "native-with-card",
      natives: Array.from({ length: nativeCount }, () => ({
        type: "restore-annotation" as const,
        node_id: "",
        prior: [] as import("../types.js").AnnotationSnapshot[],
      })),
      card: { ...tpl.card },
    };
  }
  return { ...tpl };
}

// @AX:ANCHOR [AUTO] public API contract — `planEmit` is the sole entry point invoked by WriteRouter.apply({mode:"plan-emit"}) and DaemonWriteExtension.dryRun. Result shape (manifest_entry_hash, plugin_commands, undo_descriptor_template, write_target, frame_id) is the AC-S1 5-key oracle; do not add or remove keys without updating the daemon dryRunWrite + plugin status panel renderer.
export function planEmit(
  entry: ManifestEntry,
  ctx: PlanEmitContext = {},
): PlanEmitResult {
  const commands = dispatchPlan(entry, ctx);
  return {
    manifest_entry_hash: computeManifestEntryHash(entry),
    plugin_commands: [...commands],
    undo_descriptor_template: templateFor(entry),
    write_target: entry.write_target,
    frame_id: entry.frame_id,
  };
}

export type { PlanEmitContext, PlanEmitResult, PluginCommand } from "./types.js";
export {
  PLUGIN_COMMAND_OPS,
  TARGET_TO_OP,
  type PluginCommandOp,
} from "./types.js";
