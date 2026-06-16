// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit option types.
//
// `PluginCommand` is a discriminated union mapping each WriteTarget to a
// plugin-side operation (REQ-09 sonnylazuardi tool surface mapping):
//   - annotation_card → set_annotation_card (SPEC-FIGMA-022 rename; the
//     user-facing set_annotation op now means NATIVE, see types below)
//   - descriptions_page → upsert_descriptions_page_node
//   - comment → post_comment
//   - plugin_data → set_plugin_data
//   - frame_name → set_frame_name
//   - none → noop
//
// Every command has the strict 2-key shape `{op, args}` (set equality)
// asserted by AC-S1.

import type { ManifestEntry, UndoDescriptor, WriteTarget } from "../types.js";
import type { AreaCalloutPayload, AnnotationVisualPayload } from "../annotation-text.js";

// Args shapes are documented contracts but typed as Record<string, unknown> at
// the union level so test fixtures and runtime payloads can include extra keys
// (e.g. node_id from the plugin side). The discriminator is `op`; AC-S1 only
// asserts the 2-key {op, args} set equality, not args field-by-field.
export interface SetAnnotationArgs extends AnnotationVisualPayload, Record<string, unknown> {
  frameId?: string;
  text?: string;
  position?: { x: number; y: number };
  areaCallouts?: AreaCalloutPayload[];
}
export interface UpsertDescriptionsPageArgs extends Record<string, unknown> {
  pageName?: string;
  text?: string;
  position?: { x: number; y: number };
}
export interface PostCommentArgs extends Record<string, unknown> {
  fileKey?: string;
  frameId?: string;
  text?: string;
}
export interface SetPluginDataArgs extends Record<string, unknown> {
  nodeId?: string;
  key?: string;
  value?: string;
}
export interface SetFrameNameArgs extends Record<string, unknown> {
  nodeId?: string;
  name?: string;
  originalName?: string;
}
export type NoopArgs = Record<string, unknown>;

// @AX:NOTE [AUTO]: naming-collision constraint (SPEC-FIGMA-020 REQ-12 / D5) — the
// structured-table card op literal `set_policy_card` MUST be lexically distinct
// from BOTH `set_annotation_card` (the legacy text-card 3-step decomposition,
// renamed from `set_annotation` in SPEC-FIGMA-022) and `set_native_annotation`
// (the native Dev-Mode op). The composite target
// `native_annotation_with_card` emits native ops first then exactly one
// `set_policy_card` op; reusing either existing literal would collide TARGET_TO_OP
// and the AC-S8 card rollback surface.
// SPEC-FIGMA-020 REQ-02, REQ-13 — structured-table policy card op args. Carries
// the frame anchor and the column-mapped table payload that the plugin renderer
// (createPolicyCardCanvas, T7) turns into real Figma auto-layout cells.
export interface SetPolicyCardArgs extends Record<string, unknown> {
  frameId: string;
  tables: {
    section: string;
    header: string[];
    rows: string[][];
  }[];
}

// @AX:NOTE [AUTO]: naming-collision constraint — the op name MUST be `set_native_annotation`, never `set_annotation_card` (AC-S1 / S10). The card path (`set_annotation_card`, 3-step) and the native path (`set_native_annotation`, 1-step) are distinct surfaces; reusing the card op name would collide TARGET_TO_OP and break the AC-S8 card rollback invariant. SPEC-FIGMA-022: the user-facing `set_annotation` op now ALSO routes to the native primitive in the plugin dispatcher (matching the MCP tool description), but plan-emit only ever emits `set_native_annotation` for the native targets.
// SPEC-FIGMA-018 REQ-01, REQ-02 — native Dev-Mode annotation op args. Single
// node target with a composed `labelMarkdown` and an optional `categoryId`.
export interface SetNativeAnnotationArgs extends Record<string, unknown> {
  nodeId: string;
  labelMarkdown: string;
  categoryId?: string;
}

export type PluginCommand =
  // SPEC-FIGMA-022 — legacy text-card op, renamed from `set_annotation`. The
  // bare `set_annotation` op is now the user-facing NATIVE annotation tool in
  // the plugin dispatcher and is NOT emitted by plan-emit.
  | { op: "set_annotation_card"; args: SetAnnotationArgs }
  | { op: "set_native_annotation"; args: SetNativeAnnotationArgs }
  | { op: "set_policy_card"; args: SetPolicyCardArgs }
  | { op: "upsert_descriptions_page_node"; args: UpsertDescriptionsPageArgs }
  | { op: "post_comment"; args: PostCommentArgs }
  | { op: "set_plugin_data"; args: SetPluginDataArgs }
  | { op: "set_frame_name"; args: SetFrameNameArgs }
  | { op: "noop"; args: NoopArgs };

export type PluginCommandOp = PluginCommand["op"];

export const PLUGIN_COMMAND_OPS: readonly PluginCommandOp[] = [
  "set_annotation_card",
  "set_native_annotation",
  "set_policy_card",
  "upsert_descriptions_page_node",
  "post_comment",
  "set_plugin_data",
  "set_frame_name",
  "noop",
] as const;

// @AX:ANCHOR [AUTO]: WriteTarget→PluginCommandOp routing table — sonnylazuardi tool surface mapping (REQ-09).
// @AX:REASON: Every write_target dispatch flows through this single table; drift against `vendor/.../autopus_command_dispatch.ts::TOOL_NAME_MAP` breaks AC-S1 set equality. Both tables must advance together per the REQ-17 runbook.
// @AX:NOTE [AUTO] SPEC-FIGMA-020 REQ-13 — the composite `native_annotation_with_card`
// emits TWO plugin ops in one apply: the primary `set_native_annotation` (committed
// first, authoritative) followed by exactly one secondary `set_policy_card`. This
// table records the PRIMARY op only (the routing discriminator); the secondary
// `set_policy_card` is appended by the plan helper and registered in
// PLUGIN_COMMAND_OPS. T7 adds the matching `TOOL_NAME_MAP` entry so the two tables
// advance together (set-equality parity at line above).
export const TARGET_TO_OP: Readonly<Record<WriteTarget, PluginCommandOp>> = {
  // SPEC-FIGMA-022 — annotation_card emits the renamed legacy card op.
  annotation_card: "set_annotation_card",
  native_annotation: "set_native_annotation",
  native_annotation_with_card: "set_native_annotation",
  descriptions_page: "upsert_descriptions_page_node",
  comment: "post_comment",
  plugin_data: "set_plugin_data",
  frame_name: "set_frame_name",
  none: "noop",
} as const;

export interface PlanEmitContext {
  fileKey?: string;
  frameNodeName?: string;
}

export interface PlanEmitResult {
  manifest_entry_hash: string;
  plugin_commands: PluginCommand[];
  undo_descriptor_template: UndoDescriptor;
  write_target: WriteTarget;
  frame_id: string;
}

export interface PlanHelper {
  (entry: ManifestEntry, ctx: PlanEmitContext): readonly PluginCommand[];
}
