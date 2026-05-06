// SPEC-FIGMA-004 W2 — annotation_card adapter (REQ-04(a), REQ-08, INV-002).
// Creates a Figma text node positioned relative to the target frame containing
// the manifest entry's intent text. Reversibility: delete the created node.

import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";

interface AnnotationCardClient {
  createText(args: {
    frameId: string;
    text: string;
    position?: { x: number; y: number };
  }): Promise<{ nodeId: string }>;
  deleteNode(args: { node_id: string }): Promise<void>;
}

function asClient(figma: unknown): AnnotationCardClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "annotation_card adapter requires a Figma write client",
    );
  }
  const candidate = figma as Partial<AnnotationCardClient>;
  if (
    typeof candidate.createText !== "function" ||
    typeof candidate.deleteNode !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "annotation_card client missing required methods",
    );
  }
  return candidate as AnnotationCardClient;
}

function renderAnnotationText(entry: ManifestEntry): string {
  // Intent is the load-bearing field for AC-S2 ("로그인 게이트" must appear).
  // Title + screen_id provide PM-readable provenance on the canvas.
  return `${entry.title} (${entry.screen_id})\n${entry.intent}`;
}

export async function applyAnnotationCard(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  const client = asClient(ctx.figma);
  const { nodeId } = await client.createText({
    frameId: entry.frame_id,
    text: renderAnnotationText(entry),
  });
  const undo_descriptor: UndoDescriptor = {
    type: "delete-node",
    node_id: nodeId,
  };
  return { undo_descriptor, node_id: nodeId, fallback_used: false };
}

export async function undoAnnotationCard(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "delete-node") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `annotation_card undo expected delete-node, got ${descriptor.type}`,
    );
  }
  const client = asClient(ctx.figma);
  await client.deleteNode({ node_id: descriptor.node_id });
}

export const annotationCardAdapter: Adapter = {
  apply: applyAnnotationCard,
  undo: undoAnnotationCard,
};
