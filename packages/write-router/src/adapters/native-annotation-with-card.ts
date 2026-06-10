// SPEC-FIGMA-020 T5 — native_annotation_with_card composite adapter
// (REQ-02, REQ-07, REQ-08).
//
// Delivers BOTH surfaces in one apply: the native Dev-Mode annotation (concise
// labelMarkdown, anchored to the resolved node) AND a separate real-table policy
// card next to the frame. The native annotation is the AUTHORITATIVE surface and
// is composed/committed FIRST (REQ-07): this adapter reuses `applyNativeAnnotation`
// verbatim for the native surface, captures its `restore-annotation` descriptor,
// THEN builds the card via the T3 table-payload builder and creates the card node.
//
// The apply returns ONE compound `native-with-card` undo descriptor whose `native`
// is the captured `restore-annotation` and whose `card` is the card node's
// `delete-node` (REQ-08). Undo reverses the CARD first (delete-node) then the
// NATIVE (restore-annotation) (REQ-08) by delegating native restore to
// `undoNativeAnnotation`.
//
// Table composition is delegated to `card-table-payload.ts` (T3) and native label
// composition to `native-label.ts` (reused indirectly through
// `applyNativeAnnotation`); neither is reimplemented here. The plugin-command op
// emission (`set_policy_card`) is plan-emit's concern (T6); this adapter produces
// the apply/undo logic, the compound descriptor, and the card payload, mirroring
// how the `native_annotation` adapter relates to its plan-emit helper.

import type {
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";
import {
  applyNativeAnnotation,
  undoNativeAnnotation,
} from "./native-annotation.js";
import {
  buildCardTablePayload,
  type CardTablePayload,
} from "../card-table-payload.js";

// The compound descriptor variant produced/consumed by this adapter.
type NativeWithCardDescriptor = Extract<
  UndoDescriptor,
  { type: "native-with-card" }
>;

// The captured native `restore-annotation` descriptor embedded in the compound.
type RestoreAnnotationDescriptor = Extract<
  UndoDescriptor,
  { type: "restore-annotation" }
>;

// Write surface for the policy card. `createPolicyCard` renders the real-table
// card next to the frame and returns the created node id; `deleteNode` removes
// it on undo. These mirror the annotation_card client seam (createText/deleteNode)
// but carry the structured table payload built by T3 rather than free text.
interface PolicyCardClient {
  createPolicyCard(args: {
    frameId: string;
    tables: CardTablePayload["tables"];
  }): Promise<{ nodeId: string }>;
  deleteNode(args: { node_id: string }): Promise<void>;
}

function asCardClient(figma: unknown): PolicyCardClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.MCP_PERMISSION_ERROR,
      "native_annotation_with_card adapter requires a connected Figma write client",
    );
  }
  const candidate = figma as Partial<PolicyCardClient>;
  if (
    typeof candidate.createPolicyCard !== "function" ||
    typeof candidate.deleteNode !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.MCP_PERMISSION_ERROR,
      "native_annotation_with_card client missing required card methods",
    );
  }
  return candidate as PolicyCardClient;
}

// Narrow the native apply result's undo descriptor to the `restore-annotation`
// shape the compound descriptor embeds. The native adapter returns
// `restore-annotation` for any mutated/captured node and `noop` only when there
// were zero planned writes; the composite always plans at least one native write,
// so a non-restore descriptor is a contract violation worth surfacing.
function asRestoreAnnotation(
  descriptor: UndoDescriptor,
): RestoreAnnotationDescriptor {
  if (descriptor.type === "restore-annotation") return descriptor;
  // A `noop` native result (zero planned writes) leaves nothing to restore;
  // synthesize an empty-prior restore so the compound descriptor stays
  // well-formed and undo is a structural no-op on the native surface.
  if (descriptor.type === "noop") {
    return { type: "restore-annotation", node_id: "", prior: [] };
  }
  throw new WriteRouterError(
    ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
    `native_annotation_with_card expected a restore-annotation native descriptor, got ${descriptor.type}`,
  );
}

// REQ-02, REQ-07, REQ-08 — apply the NATIVE surface first (authoritative), then
// the card. The native annotation is committed (and its prior captured) before
// the card is created so that, at the daemon level (T8), a card-step failure can
// keep the already-committed native surface without rolling it back.
//
// @AX:WARN [AUTO]: native-authoritative ordering — applyNativeAnnotation MUST run
// (and capture its restore-annotation prior) BEFORE createPolicyCard so the
// committed-first surface is the native annotation (REQ-07).
// @AX:REASON: Reordering breaks the partial-failure contract the daemon enforces
// (apply-tool.ts isCompound branch) — the native op must be the committed prefix so
// a card-step failure keeps native applied instead of rolling it back (REQ-07/AC-S4).
export async function applyNativeAnnotationWithCard(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  // 1. Native surface FIRST (authoritative). Reuse the SPEC-FIGMA-018 adapter
  //    verbatim so label composition, node resolution, idempotent-skip, and the
  //    untrusted-prior capture seam are shared, not copied.
  const nativeResult = await applyNativeAnnotation(entry, ctx);
  const nativeUndo = asRestoreAnnotation(nativeResult.undo_descriptor);

  // 2. Card surface SECOND. Delegate table composition to the T3 builder; the
  //    adapter never inlines column/row mapping.
  const cardClient = asCardClient(ctx.figma);
  const payload = buildCardTablePayload(entry);
  const { nodeId: cardNodeId } = await cardClient.createPolicyCard({
    frameId: entry.frame_id,
    tables: payload.tables,
  });

  // 3. Compose ONE compound descriptor reversing both surfaces (REQ-08). The
  //    `native` member is the captured restore-annotation; the `card` member is
  //    the card node's delete-node.
  const undo_descriptor: NativeWithCardDescriptor = {
    type: "native-with-card",
    native: nativeUndo,
    card: { type: "delete-node", node_id: cardNodeId },
  };

  const result: AdapterApplyResult = {
    undo_descriptor,
    node_id: nativeResult.node_id,
    fallback_used: nativeResult.fallback_used ?? false,
  };
  // Preserve the native surface's idempotent-skip signal: the native annotation
  // is the authoritative surface, so when it produced no net change the composite
  // reports the skip too (the card is additive and does not override it).
  if (nativeResult.status_code) result.status_code = nativeResult.status_code;
  return result;
}

// REQ-08 — reverse the CARD first (delete-node) then the NATIVE
// (restore-annotation). The native restore is delegated to `undoNativeAnnotation`
// so the empty-prior structural no-op and verbatim manual-note write-back behavior
// (SPEC-FIGMA-018 S6/S7) are reused, not reimplemented.
export async function undoNativeAnnotationWithCard(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "native-with-card") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `native_annotation_with_card undo expected native-with-card, got ${descriptor.type}`,
    );
  }
  // 1. Card surface first: remove the policy card node.
  const cardClient = asCardClient(ctx.figma);
  await cardClient.deleteNode({ node_id: descriptor.card.node_id });
  // 2. Native surface second: restore the prior annotation state.
  await undoNativeAnnotation(descriptor.native, ctx);
}
