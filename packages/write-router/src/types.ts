// SPEC-FIGMA-004 write-router public type contract.
// Aligned with spec.md § 4 routing map and Phase 1.5 acceptance scenarios.

export type WriteTarget =
  | "annotation_card"
  | "descriptions_page"
  | "comment"
  | "plugin_data"
  | "frame_name"
  | "none"
  | "native_annotation";

// SPEC-FIGMA-018 OQ-2 — minimized snapshot of a Figma native annotation,
// mirroring the fields the vendor `setAnnotation` runtime accepts/returns.
// `prior: []` (see UndoDescriptor) means the node had no annotations.
// @AX:NOTE [AUTO]: restore contract — an empty `prior: []` (UndoDescriptor.restore-annotation) means the node had NO annotations and undo is a structural no-op (S6); a non-empty array is written back verbatim (S7). Snapshot is minimized to restore-relevant fields only.
export interface AnnotationSnapshot {
  labelMarkdown: string;
  categoryId?: string;
  properties?: unknown[];
}

export type Persona = "pm" | "designer" | "dev" | "qa";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AreaAnnotation {
  area_id: string;
  title: string;
  target_area: string;
  description: string;
  interaction?: string;
  motion?: string;
  policy?: string;
  states?: string[];
  data_refs?: string[];
  qa_notes?: string[];
  placement_hint?: string;
}

export interface DataRequirement {
  data_id: string;
  name: string;
  purpose: string;
  required_values: string[];
  source?: string;
  refresh_policy?: string;
  permission?: string;
  empty_state?: string;
  notes?: string[];
}

export interface ManifestEntry {
  screen_id: string;
  frame_id: string;
  title: string;
  intent: string;
  user_value: string;
  success_criteria: string;
  states: string[];
  edge_cases: string[];
  component_refs: string[];
  data_io: string[];
  area_annotations?: AreaAnnotation[];
  data_requirements?: DataRequirement[];
  open_questions?: string[];
  design_tokens: string[];
  variants: string[];
  navigation: string[];
  confidence: number;
  intent_mismatch: boolean;
  source_hash: string;
  write_target: WriteTarget;
  persona_tags: Persona[];
  token_usage: TokenUsage;
  [extra: string]: unknown;
}

export type UndoDescriptor =
  | { type: "delete-node"; node_id: string }
  | { type: "delete-comment"; comment_id: string }
  | { type: "clear-plugin-data"; node_id: string; key: string }
  | { type: "restore-frame-name"; node_id: string; original_name: string }
  | { type: "restore-annotation"; node_id: string; prior: AnnotationSnapshot[] }
  | { type: "noop" };

export type WriteStatus = "applied" | "skipped" | "rejected";

export interface WriteResult {
  status: WriteStatus;
  status_code?: string;
  write_id: string;
  undo_descriptor?: UndoDescriptor;
  fallback_used: boolean;
  node_id?: string;
  error?: { code: string; message: string };
}

export interface Adapter {
  apply(entry: ManifestEntry, ctx: AdapterContext): Promise<AdapterApplyResult>;
  undo(descriptor: UndoDescriptor, ctx: AdapterContext): Promise<void>;
}

export interface AdapterApplyResult {
  undo_descriptor: UndoDescriptor;
  node_id?: string;
  fallback_used?: boolean;
  // Observable idempotent-skip signal (SPEC-FIGMA-018 REQ-08): set to
  // ERROR_CODES.IDEMPOTENT_SKIP when an apply produced no net change.
  status_code?: ErrorCode;
}

export interface AdapterContext {
  // Mock or real Figma write surface; adapter implementations type-narrow as needed.
  figma?: unknown;
  warn?: (msg: string) => void;
}

export const ERROR_CODES = {
  WRITE_TARGET_ROUTING_ERROR: "WRITE_TARGET_ROUTING_ERROR",
  FRAME_NAME_OPT_IN_REQUIRED: "FRAME_NAME_OPT_IN_REQUIRED",
  IDEMPOTENT_SKIP: "IDEMPOTENT_SKIP",
  MCP_PERMISSION_ERROR: "MCP_PERMISSION_ERROR",
  FALLBACK_VIA_PLUGIN_BRIDGE: "FALLBACK_VIA_PLUGIN_BRIDGE",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  // SPEC-FIGMA-007 daemon write-path additions.
  APPLY_DRIFT_ABORT: "APPLY_DRIFT_ABORT",
  PENDING_EXPIRED: "PENDING_EXPIRED",
  MISSING_DRYRUN_GATE: "MISSING_DRYRUN_GATE",
  APPLY_PARTIAL_DISCONNECT: "APPLY_PARTIAL_DISCONNECT",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class WriteRouterError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "WriteRouterError";
  }
}
