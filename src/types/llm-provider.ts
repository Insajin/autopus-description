// SPEC-FIGMA-003 T1: LLMProvider interface, request/response types, error codes.
// SPEC-FIGMA-005 T1: additive extensions for Prompt Caching, Structured Outputs
// strict, and Files API. All new fields are optional so MockLLMProvider and
// RecordedAnthropicProvider continue to work without modification (REQ-NFR-06).
// Single .ts file (not .d.ts) because ErrorCode and ProviderError are runtime values.

export interface ProviderOpts {
  temperature: number;
  model_id: string;
  max_output_tokens: number;
  // SPEC-FIGMA-005 REQ-01: opt-in cache_control region for Prompt Caching.
  // When set, anthropic-provider applies cache_control: {type: "ephemeral"} to
  // the static prefix (system prompt + schema instruction + fence boilerplate).
  cache_control_region?: string;
  // SPEC-FIGMA-005 REQ-02: Structured Outputs strict mode JSON schema.
  // When set, the call uses response_format: {type: "json_schema", json_schema:
  // {strict: true, schema}}. Strict path bypasses parseJsonBody silent fallback.
  structured_output_schema?: object;
  // SPEC-FIGMA-005 REQ-04: Files API file_id reference for Vision dedup.
  // When set, Vision call uses {type: "image", source: {type: "file", file_id}}
  // instead of base64 inline. Image input tokens = 0 on second call.
  file_id?: string;
}

export type ReviewStatus = "approved" | "pending_review";

export interface LLMResponse {
  text: string;
  input_tokens: number;
  output_tokens: number;
  confidence: number;
  intent_mismatch: boolean;
  // review_status is set later by T-PI post-hoc detector; adapters leave it undefined.
  review_status?: ReviewStatus;
  // SPEC-FIGMA-005 REQ-01, REQ-08: Prompt Caching token split.
  // cache_read_input_tokens: read from cached prefix (no recomputation).
  // cache_creation_input_tokens: written to cache for first-time prefix.
  // dynamic_input_tokens: per-frame variable input (not cached).
  // sum equals SDK total input_tokens within ±1 token rounding (REQ-20).
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  dynamic_input_tokens?: number;
  // SPEC-FIGMA-005 REQ-04: file_id used for the Vision branch (echoed for audit).
  file_id?: string;
  // SPEC-FIGMA-005 REQ-08: provider transient ids surfaced for audit only.
  // Callers MUST NOT include these in manifest_entry_hash input (REQ-07).
  provider_sdk_version?: string;
  cache_id?: string;
  request_id?: string;
}

export interface LLMProvider {
  generateNodeOnly(prompt: string, opts: ProviderOpts): Promise<LLMResponse>;
  generateVision(
    prompt: string,
    image: Buffer,
    opts: ProviderOpts,
  ): Promise<LLMResponse>;
}

// `as const` object instead of TS enum: ESM-friendly, tree-shakeable, runtime-introspectable.
export const ErrorCode = {
  TOKEN_BUDGET_EXCEEDED: "TOKEN_BUDGET_EXCEEDED",
  OUTPUT_BUDGET_EXCEEDED: "OUTPUT_BUDGET_EXCEEDED",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROMPT_INJECTION_SUSPECTED: "PROMPT_INJECTION_SUSPECTED",
  // SPEC-FIGMA-005 additive — fail-fast on silent-truncation paths (REQ-NFR-02).
  SCHEMA_STRICT_INCOMPATIBLE: "SCHEMA_STRICT_INCOMPATIBLE",
  SCHEMA_AJV_VIOLATION: "SCHEMA_AJV_VIOLATION",
  FILES_QUOTA_EXCEEDED: "FILES_QUOTA_EXCEEDED",
  BATCH_PARTIAL_FAILURE: "BATCH_PARTIAL_FAILURE",
  PROVIDER_SDK_BREAKING_CHANGE: "PROVIDER_SDK_BREAKING_CHANGE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ProviderError extends Error {
  readonly code: ErrorCode;
  readonly screen_id?: string;
  readonly metadata?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    screen_id?: string,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.screen_id = screen_id;
    this.metadata = metadata;
  }
}

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

export type WriteTarget =
  | "annotation_card"
  | "descriptions_page"
  | "frame_name"
  | "plugin_data"
  | "none";

export type PersonaTag = "pm" | "designer" | "dev" | "qa";

// Mirrors schema/frame-description.schema.json (SPEC-FIGMA-001 v0.1.0).
// Field order matches schema for grep-friendly diffing.
export interface ManifestEntry {
  screen_id: string;
  display_id: string;
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
  persona_tags: PersonaTag[];
  token_usage: TokenUsage;
  stale?: boolean;
  review_status?: ReviewStatus;
}
