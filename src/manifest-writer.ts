import { canonicalJson, type CanonicalValue } from "./source-hash.js";
import { redactJsonValue } from "./token-redactor.js";
import { stripVolatileTimestamps } from "./manifest-utils.js";

/**
 * SPEC-FIGMA-002 REQ-06: emit a partial description-manifest.json.
 *
 * Producer-owned fields: screen_id, display_id, title, navigation, source_hash,
 * design_tokens, variants, token_usage = {0,0}.
 * Generation-owned fields are left as schema defaults (filled by SPEC-FIGMA-003).
 *
 * Output is canonical JSON (sorted keys, no whitespace) so byte-equality holds
 * across runs (REQ-NFR-01).
 */

export interface PartialFrameEntry {
  readonly screen_id: string;
  readonly display_id: string;
  readonly title: string;
  readonly navigation: ReadonlyArray<string>;
  readonly source_hash: string;
  readonly design_tokens: ReadonlyArray<string> | null;
  readonly variants: ReadonlyArray<string> | null;
  readonly extraction_started_at: string;
  readonly extraction_finished_at: string;
}

export interface PartialManifest {
  readonly schema_version: string;
  readonly pilot_metadata: {
    readonly pm_reviewer_id: string;
    readonly pilot_date: string;
    readonly figma_file_ids: ReadonlyArray<string>;
    readonly total_token_cost: number;
  };
  readonly frames: ReadonlyArray<PartialFrameEntry>;
  readonly prototype: { readonly entry: string | null; readonly transitions: ReadonlyArray<{ from: string; to: string; trigger: string }> };
}

// @AX:NOTE:[AUTO] — REQ-NFR-02 schema version pinned to FIGMA-001 declaration; bumping requires additive-only minor change with FIGMA-001 schema update first
export const SCHEMA_VERSION = "0.1.0";

export function serializePartial(manifest: PartialManifest): string {
  return canonicalJson(redactJsonValue(manifest as unknown as CanonicalValue));
}

// Volatile-field stripping is the same operation used by AC-S6 idempotency and
// AC-S9 substitutability oracles; the canonical implementation lives in
// manifest-utils.ts so both call paths share one source of truth.
export function stripVolatile(manifest: PartialManifest): unknown {
  return stripVolatileTimestamps(manifest as unknown as Parameters<typeof stripVolatileTimestamps>[0]);
}

export interface MergedFrameInput {
  readonly partial: PartialFrameEntry;
  readonly figma_node_id: string;
}

/**
 * Build a fully-populated manifest entry suitable for AC-S7 schema validation.
 * Generation-owned fields are filled with placeholder values that satisfy the
 * SPEC-FIGMA-001 schema; SPEC-FIGMA-003 replaces them in production.
 */
export function buildMergedManifest(
  partial: PartialManifest,
  generationStub: GenerationStub,
): unknown {
  const frames = partial.frames.map((f) => ({
    screen_id: f.screen_id,
    display_id: f.display_id,
    title: f.title,
    intent: generationStub.intent,
    user_value: generationStub.user_value,
    success_criteria: generationStub.success_criteria,
    states: generationStub.states,
    edge_cases: generationStub.edge_cases,
    component_refs: generationStub.component_refs,
    data_io: generationStub.data_io,
    design_tokens: f.design_tokens ?? [],
    variants: f.variants ?? [],
    navigation: f.navigation,
    confidence: generationStub.confidence,
    intent_mismatch: generationStub.intent_mismatch,
    source_hash: f.source_hash,
    write_target: generationStub.write_target,
    persona_tags: generationStub.persona_tags,
    token_usage: { input_tokens: 0, output_tokens: 0 },
  }));
  return {
    schema_version: partial.schema_version,
    pilot_metadata: partial.pilot_metadata,
    frames,
  };
}

export interface GenerationStub {
  readonly intent: string;
  readonly user_value: string;
  readonly success_criteria: string;
  readonly states: ReadonlyArray<string>;
  readonly edge_cases: ReadonlyArray<string>;
  readonly component_refs: ReadonlyArray<string>;
  readonly data_io: ReadonlyArray<string>;
  readonly confidence: number;
  readonly intent_mismatch: boolean;
  readonly write_target: "annotation_card" | "descriptions_page" | "frame_name" | "plugin_data" | "none";
  readonly persona_tags: ReadonlyArray<"pm" | "designer" | "dev" | "qa">;
}

export const DEFAULT_GENERATION_STUB: GenerationStub = {
  intent: "stub intent",
  user_value: "stub user value",
  success_criteria: "stub success criteria",
  states: ["default"],
  edge_cases: ["network error"],
  component_refs: ["StubComponent"],
  data_io: ["GET /stub"],
  confidence: 0.8,
  intent_mismatch: false,
  write_target: "descriptions_page",
  persona_tags: ["pm", "designer", "dev", "qa"],
};
