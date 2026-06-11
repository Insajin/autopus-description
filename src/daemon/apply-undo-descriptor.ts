// SPEC-FIGMA-007 / SPEC-FIGMA-018 / SPEC-FIGMA-020 — undo-descriptor hydration
// and persist-time resolution for the daemon apply path. Factored out of
// apply-tool.ts to keep that file under the 300-line project limit.

import type { UndoDescriptor } from "../../packages/write-router/src/types.js";
import { redactAndMinimizePrior } from "./redact-prior-annotation.js";

// Hydrate the dryRun-stage undo template with the node ids the plugin returned
// at apply time. SPEC-FIGMA-020 REQ-08 — the compound `native-with-card`
// variant hydrates BOTH embedded descriptors: the native op (dispatched first)
// supplies the annotated node id at index 0, the card op (dispatched second)
// supplies the created card node id at index 1.
export function hydrateUndoDescriptor(
  template: UndoDescriptor | undefined,
  nodeIds: string[],
): UndoDescriptor {
  if (!template) return { type: "noop" };
  switch (template.type) {
    case "delete-node":
      return { type: "delete-node", node_id: nodeIds[0] ?? template.node_id };
    case "delete-comment":
      return { type: "delete-comment", comment_id: nodeIds[0] ?? template.comment_id };
    case "clear-plugin-data":
      return { ...template };
    case "restore-frame-name":
      return { ...template };
    case "restore-annotation":
      // SPEC-FIGMA-018 — node_id hydrated from the plugin result; the captured
      // prior snapshot array is carried through unchanged.
      return {
        type: "restore-annotation",
        node_id: nodeIds[0] ?? template.node_id,
        prior: template.prior,
      };
    case "native-with-card": {
      // SPEC-FIGMA-020 REQ-08 — hydrate ALL embedded native descriptors from the
      // command results: nodeIds[0..natives.length-1] are each native op's node_id
      // (one per UI element, dispatched first), nodeIds[natives.length] is the card
      // node_id (dispatched last). The captured prior on each native member is
      // carried through unchanged (redacted later, REQ-10).
      const hydratedNatives = template.natives.map((n, i) => ({
        type: "restore-annotation" as const,
        node_id: nodeIds[i] ?? n.node_id,
        prior: n.prior,
      }));
      return {
        type: "native-with-card",
        natives: hydratedNatives,
        card: {
          type: "delete-node",
          node_id: nodeIds[template.natives.length] ?? template.card.node_id,
        },
      };
    }
    case "noop":
      return { type: "noop" };
  }
}

// SPEC-FIGMA-020 REQ-07/REQ-10 — resolve the descriptor that is actually
// persisted into AppliedWrite / registered for undo, applying the capture-time
// redactor to any embedded captured prior. The flat restore-annotation path is
// byte-behavior-unchanged. For the compound variant: card-failure downgrades to
// the redacted native-only flat descriptor; full success keeps both surfaces
// with the native member redacted.
// @AX:WARN [AUTO]: partial-failure invariant — when `cardFailed` is true the
// native annotation was already COMMITTED FIRST (authoritative) and is KEPT, not
// rolled back; this function downgrades the persisted descriptor to the
// native-only flat restore-annotation so undo has no phantom card node to delete.
// @AX:REASON: REQ-07 / AC-S4 (deferred from SPEC-FIGMA-018) — the native-committed-first,
// card-kept-on-failure contract is load-bearing and easy to break. Returning the full
// `native-with-card` descriptor on card failure would register a delete-node for a card
// that was never created; rolling back the native surface would violate the authoritative
// ordering enforced by apply-tool.ts (isCompound branch) and native-annotation-with-card.ts.
export function computePersistedDescriptor(
  hydrated: UndoDescriptor,
  cardFailed: boolean,
): UndoDescriptor {
  if (hydrated.type === "restore-annotation") {
    return redactAndMinimizePrior(hydrated);
  }
  if (hydrated.type === "native-with-card") {
    const redactedNatives = hydrated.natives.map((n) => redactAndMinimizePrior(n));
    if (cardFailed) {
      // When the card step failed and there was exactly one native, downgrade to
      // the flat restore-annotation (preserves existing behavior, AC-S4). With
      // multiple natives the compound shape is kept but the card is voided with
      // an empty node_id sentinel so undo skips the delete.
      if (redactedNatives.length === 1) return redactedNatives[0];
      return {
        type: "native-with-card",
        natives: redactedNatives,
        card: { type: "delete-node", node_id: "" },
      };
    }
    return { type: "native-with-card", natives: redactedNatives, card: hydrated.card };
  }
  return hydrated;
}
