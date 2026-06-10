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
import { createPolicyCardCanvas } from "./autopus_policy_card_renderer.js";
import { createAutopusPluginAdapter } from "./autopus_plugin_adapter.js";

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
  setAnnotation?(args: {
    nodeId: string;
    labelMarkdown: string;
    categoryId?: string;
  }): { id?: string } | void | Promise<{ id?: string } | void>;
  setPluginData?(args: { nodeId: string; key: string; value: string }): void | Promise<void>;
  setFrameName?(args: { nodeId: string; name: string }): void | Promise<void>;
  postComment?(args: { fileKey: string; frameId: string; text: string }): { commentId: string } | Promise<{ commentId: string }>;
  upsertDescriptionsPageNode?(args: { pageName: string; text: string }): { id: string } | Promise<{ id: string }>;
  deleteNode?(args: { node_id: string }): void | Promise<void>;
  deleteComment?(args: { comment_id: string }): void | Promise<void>;
  clearPluginData?(args: { node_id: string; key: string }): void | Promise<void>;
  restoreFrameName?(args: { node_id: string; original_name: string }): void | Promise<void>;
  restoreAnnotation?(args: {
    node_id: string;
    prior: Array<{ labelMarkdown: string; categoryId?: string; properties?: unknown[] }>;
  }): void | Promise<void>;
}

// Value re-export so the bundle's IIFE global exposes the adapter factory
// (the build patch needs AutopusDispatch.createAutopusPluginAdapter). The
// adapter imports only TYPES from this file, so there is no runtime cycle.
export { createAutopusPluginAdapter };

// @AX:ANCHOR: [AUTO] op-to-tool routing table — single source of truth for the dispatch switch
// @AX:REASON: SPEC-FIGMA-007 REQ-17 mandates that TOOL_NAME_MAP and the AUTOPUS_PIN.md
//             `## Tool Mapping Changes` table MUST advance together; a case arm added here
//             without a matching PIN.md entry breaks the upstream rename runbook.
// Tool name mapping table. SPEC-FIGMA-007 REQ-09. When sonnylazuardi renames
// a tool upstream, update both this table AND the AUTOPUS_PIN.md
// `## Tool Mapping Changes` table — see REQ-17 runbook.
export const TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  set_annotation: "set_annotation",
  // SPEC-FIGMA-018 S10 — autopus op set_native_annotation routes to the vendor
  // NATIVE tool set_annotation (the real Dev-Mode annotation API), never the
  // card path. The op name stays lexically distinct from autopus set_annotation.
  set_native_annotation: "set_annotation",
  // SPEC-FIGMA-020 REQ-13 — autopus op set_policy_card routes to the vendor
  // set_policy_card tool (the structured-table policy card renderer), distinct
  // from BOTH set_annotation (the card 3-step path) and set_native_annotation
  // (the Dev-Mode native path). Keeps @AX:ANCHOR set-equality parity with the
  // write-router PLUGIN_COMMAND_OPS table.
  set_policy_card: "set_policy_card",
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

// SPEC-FIGMA-018 S10 — autopus op set_native_annotation. Redacts the composed
// labelMarkdown (REQ-05 boundary) and forwards to the vendor NATIVE setAnnotation
// tool. This is the Dev-Mode annotation primitive, NOT the card path.
async function dispatchSetNativeAnnotation(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  if (!figma.setAnnotation) return { ok: true, node_ids: [] };
  const labelMarkdown = autopusRedact(asString(args.labelMarkdown));
  const nodeId = asString(args.nodeId);
  const categoryId = asString(args.categoryId) || undefined;
  await Promise.resolve(
    figma.setAnnotation({ nodeId, labelMarkdown, categoryId }),
  );
  return { ok: true, node_ids: [nodeId] };
}

interface PolicyCardTablePayload {
  section: string;
  header: string[];
  rows: string[][];
}

// Coerces the raw args.tables payload into typed tables, redacting EVERY string
// (section label, every header cell, every row cell) via autopusRedact BEFORE
// any node is created (SPEC-FIGMA-020 REQ-09 wire-redaction parity). No cell
// text reaches createPolicyCardCanvas un-redacted.
function redactPolicyTables(value: unknown): PolicyCardTablePayload[] {
  if (!Array.isArray(value)) return [];
  const out: PolicyCardTablePayload[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const header = Array.isArray(raw.header)
      ? raw.header.map((cell) => autopusRedact(asString(cell)))
      : [];
    const rows = Array.isArray(raw.rows)
      ? raw.rows.map((row) =>
          Array.isArray(row) ? row.map((cell) => autopusRedact(asString(cell))) : [],
        )
      : [];
    out.push({
      section: autopusRedact(asString(raw.section)),
      header,
      rows,
    });
  }
  return out;
}

// SPEC-FIGMA-020 REQ-13, REQ-09 — autopus op set_policy_card. Redacts all table
// text (header + every row cell) up front, then routes to the structured-table
// renderer createPolicyCardCanvas when the runtime supports it. Mirrors
// dispatchSetAnnotation's { ok, node_ids } return contract; degrades gracefully
// to an empty node_ids list when the runtime is unsupported.
async function dispatchSetPolicyCard(
  figma: FigmaPluginLike,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  const tables = redactPolicyTables(args.tables);
  if (!supportsAreaHandoffRuntime(figma)) return { ok: true, node_ids: [] };
  const node = await createPolicyCardCanvas(figma, {
    frameId: asString(args.frameId),
    tables,
    documentWidth:
      typeof args.documentWidth === "number" ? args.documentWidth : undefined,
  });
  return { ok: true, node_ids: node.node_ids };
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
      // SPEC-FIGMA-021 — accept both the inverse-op snake_case `node_id` (undo
      // path / compound card delete) AND the vendor forward-tool camelCase
      // `nodeId` (general delete_node MCP tool), since this op is now routed
      // through the dispatcher in the built plugin for BOTH callers.
      if (figma.deleteNode) await Promise.resolve(figma.deleteNode({ node_id: asString(args.node_id) || asString(args.nodeId) }));
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
    case "restore_annotation":
      // @AX:WARN: [AUTO] unvalidated prior array cast — args.prior is cast to the annotation snapshot type without
      // @AX:REASON: if the daemon serializes the prior array with an unexpected shape (e.g. missing labelMarkdown),
      //             the plugin adapter receives malformed entries and writeAnnotations silently writes invalid
      //             annotation objects to node.annotations. Add element-level validation (typeof check on
      //             labelMarkdown) before forwarding to restoreAnnotation.
      if (figma.restoreAnnotation)
        await Promise.resolve(figma.restoreAnnotation({
          node_id: asString(args.node_id),
          prior: Array.isArray(args.prior) ? (args.prior as Array<{ labelMarkdown: string; categoryId?: string; properties?: unknown[] }>) : [],
        }));
      return { ok: true };
    default:
      return { ok: false, error: `unknown_inverse_op:${op}` };
  }
}

// @AX:ANCHOR: [AUTO] public dispatch API — daemon-to-plugin command entry point
// @AX:REASON: dispatchPluginCommand is the only function called by the daemon WebSocket bridge; its
//             signature (FigmaPluginLike, PluginCommand) → CommandResult is a stable contract shared
//             with the test harness. Changing the parameter types or return shape requires coordinating
//             updates in apply-tool.ts, the mock bridge, and all integration tests.
export async function dispatchPluginCommand(
  figma: FigmaPluginLike,
  cmd: PluginCommand,
): Promise<CommandResult> {
  const safeArgs = redactArgs(cmd.args);
  try {
    switch (cmd.op) {
      case "set_annotation":
        return await dispatchSetAnnotation(figma, safeArgs);
      case "set_native_annotation":
        return await dispatchSetNativeAnnotation(figma, safeArgs);
      case "set_policy_card":
        return await dispatchSetPolicyCard(figma, safeArgs);
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
