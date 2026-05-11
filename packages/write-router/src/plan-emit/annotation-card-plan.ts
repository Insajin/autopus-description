// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit helper for annotation_card.
//
// AC-S8 (REQ-14) requires annotation_card to decompose into 3 sub-commands
// (create-node, set-text, attach-link) so the partial-disconnect rollback
// surface is observable: the bridge can drop after 2 successful results and
// the daemon must roll back the 2 completed steps. Text composition mirrors
// the executor-side `applyAnnotationCard` exactly (NFR-04 behavior parity).

import type { ManifestEntry } from "../types.js";
import { buildAnnotationCreateArgs } from "../annotation-text.js";
import type { PluginCommand } from "./types.js";

// @AX:NOTE [AUTO] AC-S8/REQ-14 — fixed 3-step decomposition (create-node, set-text, attach-link); changing the count or order alters the partial-disconnect rollback observation surface. The bridge is contracted to drop after step 2 in AC-S8.
export function planAnnotationCard(
  entry: ManifestEntry,
): readonly PluginCommand[] {
  const createArgs = buildAnnotationCreateArgs(entry);
  const text = createArgs.text;
  return [
    { op: "set_annotation", args: { ...createArgs, step: "create-node" } },
    { op: "set_annotation", args: { frameId: entry.frame_id, text, step: "set-text" } },
    { op: "set_annotation", args: { frameId: entry.frame_id, text, step: "attach-link" } },
  ];
}
