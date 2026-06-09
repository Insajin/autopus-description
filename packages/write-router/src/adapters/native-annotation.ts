// SPEC-FIGMA-018 T4 — native_annotation adapter (apply + undo).
//
// Delivers descriptions as Figma native Dev-Mode annotations anchored to a
// resolved node (one per area; frame-level fallback when no area exists). Undo
// captures the prior `node.annotations` as a minimized AnnotationSnapshot[] so
// the write is fully reversible (REQ-06). Re-apply with identical content is an
// observable no-op (REQ-08). Disconnected/incapable bridge rejects with zero
// mutation (REQ-07) via the asClient guard, mirroring annotation-card.ts.

import type {
  AdapterApplyResult,
  AdapterContext,
  AnnotationSnapshot,
  AreaAnnotation,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";
import { composeAreaLabel, composeFrameLabel, truncateLabel } from "../native-label.js";
import { resolveAreaNode } from "../area-node-resolver.js";
import { buildNodeIndex } from "../native-annotation-index.js";

// @AX:NOTE [AUTO]: magic constant — must stay equal to plan-emit/native-annotation-plan.ts LABEL_BUDGET so adapter/plan-emit truncation parity holds (REQ-10).
// REQ-10 — conservative native annotation label length budget (OQ-4 default).
const LABEL_BUDGET = 500;

interface NativeAnnotationClient {
  scan(args?: unknown): Promise<{ nodes?: Array<{ id: string; name: string }> }>;
  getAnnotations(args: { nodeId: string }): Promise<{ annotations?: AnnotationSnapshot[] }>;
  setAnnotation(args: {
    nodeId: string;
    labelMarkdown: string;
    categoryId?: string;
  }): Promise<unknown>;
}

function asClient(figma: unknown): NativeAnnotationClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.MCP_PERMISSION_ERROR,
      "native_annotation adapter requires a connected Figma write client",
    );
  }
  const candidate = figma as Partial<NativeAnnotationClient>;
  if (
    typeof candidate.scan !== "function" ||
    typeof candidate.getAnnotations !== "function" ||
    typeof candidate.setAnnotation !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.MCP_PERMISSION_ERROR,
      "native_annotation client missing required methods",
    );
  }
  return candidate as NativeAnnotationClient;
}

interface PlannedWrite {
  nodeId: string;
  labelMarkdown: string;
  categoryId?: string;
  fallbackUsed: boolean;
}

// REQ-11 — resolve an optional categoryId from a manifest area signal. Omit
// (never fail) when no category resource is present.
function resolveCategoryId(area: AreaAnnotation): string | undefined {
  const raw = (area as unknown as Record<string, unknown>).category_id;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function planWrites(entry: ManifestEntry, nodeIndex: Record<string, string>): PlannedWrite[] {
  const areas = entry.area_annotations ?? [];
  if (areas.length === 0) {
    return [
      {
        nodeId: entry.frame_id,
        labelMarkdown: truncateLabel(composeFrameLabel(entry), LABEL_BUDGET),
        fallbackUsed: false,
      },
    ];
  }
  return areas.map((area) => {
    const resolution = resolveAreaNode(area, entry.frame_id, nodeIndex);
    const categoryId = resolveCategoryId(area);
    return {
      nodeId: resolution.node_id,
      labelMarkdown: truncateLabel(composeAreaLabel(area), LABEL_BUDGET),
      ...(categoryId ? { categoryId } : {}),
      fallbackUsed: resolution.fallback_used,
    };
  });
}

// Minimize a captured prior annotation array to the restore-only fields.
function minimizePrior(annotations: AnnotationSnapshot[] | undefined): AnnotationSnapshot[] {
  return (annotations ?? []).map((a) => ({
    labelMarkdown: a.labelMarkdown,
    ...(a.categoryId !== undefined ? { categoryId: a.categoryId } : {}),
    ...(a.properties !== undefined ? { properties: a.properties } : {}),
  }));
}

// REQ-08 — the new set this write would produce for a single node.
function equalsPlanned(prior: AnnotationSnapshot[], planned: PlannedWrite): boolean {
  if (prior.length !== 1) return false;
  const only = prior[0];
  return (
    only.labelMarkdown === planned.labelMarkdown &&
    (only.categoryId ?? undefined) === (planned.categoryId ?? undefined)
  );
}

// @AX:WARN [AUTO]: trust-boundary capture seam — reads untrusted prior node.annotations into restore-annotation undo descriptors (REQ-06, REQ-14).
// @AX:REASON: The prior snapshot captured here is raw external input; it is only redacted downstream at the daemon (redactAndMinimizePrior in apply-tool.ts). minimizePrior strips non-restore fields but does NOT scrub secrets. equalsPlanned drives the REQ-08 idempotent-skip — a subtle equality change can silently re-mutate or wrongly skip the node.
export async function applyNativeAnnotation(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  const client = asClient(ctx.figma);
  const nodeIndex = buildNodeIndex(await client.scan());
  const writes = planWrites(entry, nodeIndex);

  const undoDescriptors: Extract<UndoDescriptor, { type: "restore-annotation" }>[] = [];
  let fallbackUsed = false;
  let mutated = false;

  for (const write of writes) {
    fallbackUsed = fallbackUsed || write.fallbackUsed;
    const prior = minimizePrior((await client.getAnnotations({ nodeId: write.nodeId })).annotations);
    undoDescriptors.push({ type: "restore-annotation", node_id: write.nodeId, prior });

    if (equalsPlanned(prior, write)) continue; // REQ-08 idempotent skip for this node.

    await client.setAnnotation({
      nodeId: write.nodeId,
      labelMarkdown: write.labelMarkdown,
      ...(write.categoryId ? { categoryId: write.categoryId } : {}),
    });
    mutated = true;
  }

  const primary = undoDescriptors[0] ?? { type: "noop" as const };
  const result: AdapterApplyResult = {
    undo_descriptor: primary,
    node_id: writes[0]?.nodeId,
    fallback_used: fallbackUsed,
  };
  if (!mutated) result.status_code = ERROR_CODES.IDEMPOTENT_SKIP;
  return result;
}

export async function undoNativeAnnotation(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "restore-annotation") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `native_annotation undo expected restore-annotation, got ${descriptor.type}`,
    );
  }
  const client = asClient(ctx.figma);
  // Restore the exact prior state. An empty prior means the node had no
  // annotations: the apply path captured `[]` and the restore is a structural
  // no-op (the native runtime overwrite already left the node empty, and
  // writing an empty label would instead create a blank annotation). Skipping
  // the call keeps the restored set exactly `[]` (S6).
  if (descriptor.prior.length === 0) {
    return;
  }
  // A captured manual note is written back verbatim (S7).
  for (const snapshot of descriptor.prior) {
    await client.setAnnotation({
      nodeId: descriptor.node_id,
      labelMarkdown: snapshot.labelMarkdown,
      ...(snapshot.categoryId ? { categoryId: snapshot.categoryId } : {}),
    });
  }
}
