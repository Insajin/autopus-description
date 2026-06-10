// SPEC-FIGMA-021 — bridges the LIVE Figma `figma` global to the canonical
// dispatcher. The dispatcher (autopus_command_dispatch.ts) expects ONE object
// that simultaneously satisfies:
//   - the RAW canvas runtime (AreaHandoffRuntime) used by createPolicyCardCanvas
//     and createAreaHandoffCanvas (currentPage / getNodeByIdAsync / createFrame /
//     createText / createRectangle / loadFontAsync), and
//   - the high-level FigmaPluginLike.setAnnotation primitive (the SPEC-FIGMA-018
//     NATIVE Dev-Mode annotation path), plus the compound-undo inverse helpers
//     deleteNode (card delete) and restoreAnnotation (native restore).
//
// HC-4 redaction boundary: every string this adapter receives has ALREADY been
// redacted inside dispatch (autopusRedact runs on labelMarkdown and table cells
// before any node mutation). The adapter MUST NOT re-introduce raw user text or
// add mutation before the node.annotations assignment.

import type { FigmaPluginLike } from "./autopus_command_dispatch.js";
import type { AreaHandoffRuntime } from "./autopus_area_handoff_renderer.js";

// LOCAL minimal snapshot type. The vendor tree is self-contained — the renderers
// mirror types locally rather than importing from packages/write-router.
interface AnnotationSnapshotLike {
  labelMarkdown: string;
  categoryId?: string;
  properties?: unknown[];
}

type AnnotationEntry = { labelMarkdown: string; categoryId?: string };

// Builds the native annotation array entry, dropping an absent categoryId so
// forward (setAnnotation) and inverse (restoreAnnotation) write the SAME shape.
function toAnnotation(labelMarkdown: string, categoryId?: string): AnnotationEntry {
  return { labelMarkdown, ...(categoryId ? { categoryId } : {}) };
}

export type AutopusPluginAdapter = FigmaPluginLike &
  AreaHandoffRuntime & {
    deleteNode(a: { node_id: string }): Promise<void> | void;
    restoreAnnotation(a: {
      node_id: string;
      prior: AnnotationSnapshotLike[];
    }): Promise<void> | void;
  };

// @AX:ANCHOR: [AUTO] public factory — sole entry point bridging the live figma global to the dispatcher
// @AX:REASON: createAutopusPluginAdapter is the architectural boundary consumed by autopus_command_dispatch.ts;
//             changing the function signature or return type breaks the dispatcher's type contract.
export function createAutopusPluginAdapter(
  figmaGlobal: Record<string, any>,
): AutopusPluginAdapter {
  // @AX:WARN: [AUTO] shared write helper — used by both forward setAnnotation AND inverse restoreAnnotation
  // @AX:REASON: any change to writeAnnotations (e.g. appending extra fields, changing async behavior) applies
  //             to BOTH the apply path and the undo path simultaneously; test both when modifying.
  // Shared private helper: resolve a node and write the native annotations array.
  // Reused by both the forward setAnnotation path and the inverse restore path so
  // the two never diverge on the node.annotations API.
  async function writeAnnotations(
    nodeId: string,
    annotations: AnnotationEntry[],
  ): Promise<void> {
    const node = await figmaGlobal.getNodeByIdAsync(nodeId);
    if (!node) throw new Error("node_not_found");
    if (!("annotations" in node)) {
      throw new Error("node_does_not_support_annotations");
    }
    node.annotations = annotations;
  }

  const adapter: AutopusPluginAdapter = {
    // --- RAW AreaHandoffRuntime pass-through delegates (bind `this` correctly) ---
    get currentPage() {
      return figmaGlobal.currentPage;
    },
    getNodeByIdAsync: (...a: [string]) => figmaGlobal.getNodeByIdAsync(...a),
    createFrame: (...a: unknown[]) => figmaGlobal.createFrame(...a),
    // RAW zero-arg createText form returning a node (canvas runtime contract).
    createText: ((...a: unknown[]) =>
      figmaGlobal.createText(...a)) as unknown as AutopusPluginAdapter["createText"],
    createRectangle: (...a: unknown[]) => figmaGlobal.createRectangle(...a),
    loadFontAsync: (...a: [{ family: string; style: string }]) =>
      figmaGlobal.loadFontAsync(...a),

    // --- High-level NATIVE Dev-Mode annotation primitive (FigmaPluginLike) ---
    // @AX:WARN: [AUTO] HC-4 redaction boundary — labelMarkdown arrives already redacted by autopusRedact in dispatch
    // @AX:REASON: introducing any string transformation here (e.g. template interpolation, concatenation with raw
    //             user input) violates the HC-4 contract and can leak secrets into node.annotations. The adapter
    //             MUST pass the string through unmodified.
    // Mirrors the SPEC-FIGMA-018 native path. The string is ALREADY redacted by
    // dispatch — no extra mutation before this assignment (HC-4).
    async setAnnotation({ nodeId, labelMarkdown, categoryId }) {
      await writeAnnotations(nodeId, [toAnnotation(labelMarkdown, categoryId)]);
    },

    // --- Compound-undo inverse helpers ---
    // Card delete inverse: resolve node and remove it if present.
    async deleteNode({ node_id }) {
      const node = await figmaGlobal.getNodeByIdAsync(node_id);
      if (node && typeof node.remove === "function") node.remove();
    },

    // @AX:NOTE: [AUTO] empty-prior-clears contract — passing an empty prior array sets node.annotations to [];
    //           this is intentional for undo when the node had no annotations before apply.
    // Native restore inverse: write the prior snapshot back (empty prior clears
    // the node annotations to []). Reuses the SAME native node.annotations API.
    async restoreAnnotation({ node_id, prior }) {
      const annotations =
        Array.isArray(prior) && prior.length
          ? prior.map((p) => toAnnotation(p.labelMarkdown, p.categoryId))
          : [];
      await writeAnnotations(node_id, annotations);
    },
  } as AutopusPluginAdapter;

  return adapter;
}
