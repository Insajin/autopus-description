// SPEC-FIGMA-004 W2 — descriptions_page adapter (REQ-04(b), REQ-08, INV-002).
// Lazily creates a dedicated "Descriptions" page in the Figma file and writes
// each manifest entry as a text node. Reversibility: delete the created node.

import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";

export const DESCRIPTIONS_PAGE_NAME = "Descriptions";

interface DescriptionsPageClient {
  getOrCreatePage(args: {
    fileKey?: string;
    pageName: string;
  }): Promise<{ pageId: string }>;
  createTextOnPage(args: {
    pageId: string;
    text: string;
    position?: { x: number; y: number };
  }): Promise<{ nodeId: string }>;
  deleteNode(nodeId: string): Promise<void>;
}

function asClient(figma: unknown): DescriptionsPageClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "descriptions_page adapter requires a Figma write client",
    );
  }
  const candidate = figma as Partial<DescriptionsPageClient>;
  if (
    typeof candidate.getOrCreatePage !== "function" ||
    typeof candidate.createTextOnPage !== "function" ||
    typeof candidate.deleteNode !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "descriptions_page client missing required methods",
    );
  }
  return candidate as DescriptionsPageClient;
}

function renderEntryText(entry: ManifestEntry): string {
  const lines = [
    `# ${entry.title} (${entry.screen_id})`,
    `Intent: ${entry.intent}`,
    `User value: ${entry.user_value}`,
    `Success criteria: ${entry.success_criteria}`,
  ];
  return lines.join("\n");
}

export async function applyDescriptionsPage(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  const client = asClient(ctx.figma);
  const { pageId } = await client.getOrCreatePage({
    pageName: DESCRIPTIONS_PAGE_NAME,
  });
  const { nodeId } = await client.createTextOnPage({
    pageId,
    text: renderEntryText(entry),
  });
  const undo_descriptor: UndoDescriptor = {
    type: "delete-node",
    node_id: nodeId,
  };
  return { undo_descriptor, node_id: nodeId, fallback_used: false };
}

export async function undoDescriptionsPage(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "delete-node") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `descriptions_page undo expected delete-node, got ${descriptor.type}`,
    );
  }
  const client = asClient(ctx.figma);
  await client.deleteNode(descriptor.node_id);
}

export const descriptionsPageAdapter: Adapter = {
  apply: applyDescriptionsPage,
  undo: undoDescriptionsPage,
};
