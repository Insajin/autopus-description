// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit option types.
//
// `PluginCommand` is a discriminated union mapping each WriteTarget to a
// plugin-side operation (REQ-09 sonnylazuardi tool surface mapping):
//   - annotation_card → set_annotation
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

export type PluginCommand =
  | { op: "set_annotation"; args: SetAnnotationArgs }
  | { op: "upsert_descriptions_page_node"; args: UpsertDescriptionsPageArgs }
  | { op: "post_comment"; args: PostCommentArgs }
  | { op: "set_plugin_data"; args: SetPluginDataArgs }
  | { op: "set_frame_name"; args: SetFrameNameArgs }
  | { op: "noop"; args: NoopArgs };

export type PluginCommandOp = PluginCommand["op"];

export const PLUGIN_COMMAND_OPS: readonly PluginCommandOp[] = [
  "set_annotation",
  "upsert_descriptions_page_node",
  "post_comment",
  "set_plugin_data",
  "set_frame_name",
  "noop",
] as const;

// @AX:ANCHOR [AUTO] WriteTarget→PluginCommandOp routing table — sonnylazuardi tool surface mapping (REQ-09). Drift between this table and `vendor/.../autopus_command_dispatch.ts::TOOL_NAME_MAP` breaks AC-S1 set equality. Both tables must advance together per REQ-17 runbook.
export const TARGET_TO_OP: Readonly<Record<WriteTarget, PluginCommandOp>> = {
  annotation_card: "set_annotation",
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
