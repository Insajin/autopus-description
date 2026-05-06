// SPEC-FIGMA-003 T1: LLMProvider interface, request/response types, error codes.
// Single .ts file (not .d.ts) because ErrorCode and ProviderError are runtime values.

export interface ProviderOpts {
  temperature: number;
  model_id: string;
  max_output_tokens: number;
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
