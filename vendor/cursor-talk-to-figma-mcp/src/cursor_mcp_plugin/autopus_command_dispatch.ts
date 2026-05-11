// SPEC-FIGMA-007 REQ-09, REQ-13, REQ-17 — plugin-side PluginCommand dispatcher.
//
// Receives a `PluginCommand` from the daemon (over the WebSocket bridge), maps
// `op` to either an existing sonnylazuardi tool name OR an autopus-authored
// handler, runs the operation in the Figma plugin sandbox, and returns
// `command_result{ ok, node_ids?, error? }` to the daemon.
//
// All string fields in the command args are passed through `autopusRedact`
// (REQ-13) before any Figma node mutation so figd_/xoxb-/bearer/absolute-path
// secrets never reach a node text or pluginData entry.
//
// The dispatcher is the single point that changes when sonnylazuardi renames
// an upstream tool (REQ-17). The `## Tool Mapping Changes` table in
// AUTOPUS_PIN.md and the `case` arms here MUST advance together.

import { autopusRedact, autopusRedactObject } from "./autopus_redact.js";
import {
  createAreaHandoffCanvas,
  supportsAreaHandoffRuntime,
} from "./autopus_area_handoff_renderer.js";

export interface PluginCommand {
  op: string;
  args: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  node_ids?: string[];
  error?: string;
}

export interface AreaHandoffCallout {
  areaId: string;
  badgeLabel: string;
  title: string;
  targetArea: string;
  description: string;
  placementHint?: string;
  dataRefs?: string[];
  documentAnchor?: string;
}

// Minimal Figma plugin runtime surface used by the dispatcher. The real
// `figma` global supplies these methods; in tests we inject a stub.
export interface FigmaPluginLike {
  createText?(args: {
    frameId: string;
    text: string;
    layout?: string;
    areaCallouts?: AreaHandoffCallout[];
    documentPosition?: string;
    visualPolicy?: Record<string, unknown>;
  }): { id: string } | Promise<{ id: string }>;
  createAreaHandoff?(args: {
    frameId: string;
    text: string;
    areaCallouts: AreaHandoffCallout[];
    documentPosition?: string;
    visualPolicy?: Record<string, unknown>;
  }): { id: string; node_ids?: string[] } | Promise<{ id: string; node_ids?: string[] }>;
  setPluginData?(args: { nodeId: string; key: string; value: string }): void | Promise<void>;
  setFrameName?(args: { nodeId: string; name: string }): void | Promise<void>;
  postComment?(args: { fileKey: string; frameId: string; text: string }): { commentId: string } | Promise<{ commentId: string }>;
  upsertDescriptionsPageNode?(args: { pageName: string; text: string }): { id: string } | Promise<{ id: string }>;
  deleteNode?(args: { node_id: string }): void | Promise<void>;
  deleteComment?(args: { comment_id: string }): void | Promise<void>;
  clearPluginData?(args: { node_id: string; key: string }): void | Promise<void>;
  restoreFrameName?(args: { node_id: string; original_name: string }): void | Promise<void>;
}

// Tool name mapping table. SPEC-FIGMA-007 REQ-09. When sonnylazuardi renames
// a tool upstream, update both this table AND the AUTOPUS_PIN.md
// `## Tool Mapping Changes` table — see REQ-17 runbook.
export const TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  set_annotation: "set_annotation",
  upsert_descriptions_page_node: "upsert_descriptions_page_node",
  post_comment: "post_comment",
  set_plugin_data: "set_plugin_data",
  set_frame_name: "set_frame_name",
  noop: "noop",
  delete_node: "delete_node",
  delete_comment: "delete_comment",
  clear_plugin_data: "clear_plugin_data",
  restore_frame_name: "restore_frame_name",
} as const;

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  return autopusRedactObject(args) as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asAreaCallouts(value: unknown): AreaHandoffCallout[] {
  if (!Array.isArray(value)) return [];
  const out: AreaHandoffCallout[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const areaId = asString(raw.areaId);
    const badgeLabel = asString(raw.badgeLabel, areaId);
    const title = asString(raw.title);
    const targetArea = asString(raw.targetArea);
    const description = asString(raw.description);
    if (!areaId || !title || !targetArea || !description) continue;
    out.push({
      areaId,
      badgeLabel,
      title,
      targetArea,
      description,
      placementHint: asString(raw.placementHint) || undefined,
      dataRefs: Array.isArray(raw.dataRefs)
        ? raw.dataRefs.filter((v): v is string => typeof v === "string")
        : [],
      documentAnchor: asString(raw.documentAnchor) || undefined,
    });
  }
  return out;
}

async function dispatchSetAnnotation(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  const step = asString(args.step);
  if (step && step !== "create-node") return { ok: true, node_ids: [] };
  const text = autopusRedact(asString(args.text));
  const areaCallouts = asAreaCallouts(args.areaCallouts);
  if (args.layout === "area_handoff" && areaCallouts.length > 0 && figma.createAreaHandoff) {
    const node = await Promise.resolve(
      figma.createAreaHandoff({
        frameId: asString(args.frameId),
        text,
        areaCallouts,
        documentPosition: asString(args.documentPosition) || undefined,
        visualPolicy:
          args.visualPolicy && typeof args.visualPolicy === "object"
            ? (args.visualPolicy as Record<string, unknown>)
            : undefined,
      }),
    );
    return { ok: true, node_ids: node.node_ids ?? [node.id] };
  }
  if (args.layout === "area_handoff" && areaCallouts.length > 0 && supportsAreaHandoffRuntime(figma)) {
    const node = await createAreaHandoffCanvas(figma, {
      frameId: asString(args.frameId),
      text,
      areaCallouts,
      documentPosition: asString(args.documentPosition) || undefined,
      visualPolicy:
        args.visualPolicy && typeof args.visualPolicy === "object"
          ? (args.visualPolicy as Record<string, unknown>)
          : undefined,
    });
    return { ok: true, node_ids: node.node_ids };
  }
  if (!figma.createText) return { ok: true, node_ids: [] };
  const node = await Promise.resolve(
    figma.createText({
      frameId: asString(args.frameId),
      text,
      layout: asString(args.layout) || undefined,
      areaCallouts,
      documentPosition: asString(args.documentPosition) || undefined,
      visualPolicy:
        args.visualPolicy && typeof args.visualPolicy === "object"
          ? (args.visualPolicy as Record<string, unknown>)
          : undefined,
    }),
  );
  return { ok: true, node_ids: [node.id] };
}

async function dispatchUpsertDescriptionsPage(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  if (!figma.upsertDescriptionsPageNode) return { ok: true, node_ids: [] };
  const text = autopusRedact(asString(args.text));
  const node = await Promise.resolve(
    figma.upsertDescriptionsPageNode({ pageName: asString(args.pageName), text }),
  );
  return { ok: true, node_ids: [node.id] };
}

async function dispatchPostComment(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  if (!figma.postComment) return { ok: true, node_ids: [] };
  const text = autopusRedact(asString(args.text));
  const out = await Promise.resolve(
    figma.postComment({
      fileKey: asString(args.fileKey),
      frameId: asString(args.frameId),
      text,
    }),
  );
  return { ok: true, node_ids: [out.commentId] };
}

async function dispatchSetPluginData(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  if (!figma.setPluginData) return { ok: true, node_ids: [] };
  const value = autopusRedact(asString(args.value));
  await Promise.resolve(
    figma.setPluginData({
      nodeId: asString(args.nodeId),
      key: asString(args.key),
      value,
    }),
  );
  return { ok: true, node_ids: [asString(args.nodeId)] };
}

async function dispatchSetFrameName(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  if (!figma.setFrameName) return { ok: true, node_ids: [] };
  const name = autopusRedact(asString(args.name));
  await Promise.resolve(
    figma.setFrameName({ nodeId: asString(args.nodeId), name }),
  );
  return { ok: true, node_ids: [asString(args.nodeId)] };
}

async function dispatchInverse(
  figma: FigmaPluginLike,
  op: string,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  switch (op) {
    case "delete_node":
      if (figma.deleteNode) await Promise.resolve(figma.deleteNode({ node_id: asString(args.node_id) }));
      return { ok: true };
    case "delete_comment":
      if (figma.deleteComment) await Promise.resolve(figma.deleteComment({ comment_id: asString(args.comment_id) }));
      return { ok: true };
    case "clear_plugin_data":
      if (figma.clearPluginData) await Promise.resolve(figma.clearPluginData({ node_id: asString(args.node_id), key: asString(args.key) }));
      return { ok: true };
    case "restore_frame_name":
      if (figma.restoreFrameName) await Promise.resolve(figma.restoreFrameName({ node_id: asString(args.node_id), original_name: asString(args.original_name) }));
      return { ok: true };
    default:
      return { ok: false, error: `unknown_inverse_op:${op}` };
  }
}

export async function dispatchPluginCommand(
  figma: FigmaPluginLike,
  cmd: PluginCommand,
): Promise<CommandResult> {
  const safeArgs = redactArgs(cmd.args);
  try {
    switch (cmd.op) {
      case "set_annotation":
        return await dispatchSetAnnotation(figma, safeArgs);
      case "upsert_descriptions_page_node":
        return await dispatchUpsertDescriptionsPage(figma, safeArgs);
      case "post_comment":
        return await dispatchPostComment(figma, safeArgs);
      case "set_plugin_data":
        return await dispatchSetPluginData(figma, safeArgs);
      case "set_frame_name":
        return await dispatchSetFrameName(figma, safeArgs);
      case "noop":
        return { ok: true };
      default:
        return await dispatchInverse(figma, cmd.op, safeArgs);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
