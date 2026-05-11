// SPEC-FIGMA-003: Coerce LLM JSON body into a schema-shaped ManifestEntry.
// Provides default shell + safe string/array narrowing for unknown LLM output.

import type {
  AreaAnnotation,
  DataRequirement,
  ManifestEntry,
  PersonaTag,
  WriteTarget,
} from "./types/llm-provider.js";
import type { FrameInput } from "./routing.js";

interface ParsedLLMBody {
  intent?: unknown;
  user_value?: unknown;
  success_criteria?: unknown;
  states?: unknown;
  edge_cases?: unknown;
  data_io?: unknown;
  area_annotations?: unknown;
  data_requirements?: unknown;
  intent_mismatch?: unknown;
  confidence?: unknown;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function safeStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = safeString(obj[key]).trim();
  return value.length > 0 ? value : undefined;
}

function safeAreaAnnotations(v: unknown): AreaAnnotation[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: AreaAnnotation[] = [];
  for (const item of v) {
    const obj = record(item);
    if (!obj) continue;
    const area_id = safeString(obj.area_id).trim();
    const title = safeString(obj.title).trim();
    const target_area = safeString(obj.target_area).trim();
    const description = safeString(obj.description).trim();
    if (!area_id || !title || !target_area || !description) continue;
    out.push({
      area_id,
      title,
      target_area,
      description,
      interaction: optionalString(obj, "interaction"),
      motion: optionalString(obj, "motion"),
      policy: optionalString(obj, "policy"),
      states: safeStringArray(obj.states),
      data_refs: safeStringArray(obj.data_refs),
      qa_notes: safeStringArray(obj.qa_notes),
      placement_hint: optionalString(obj, "placement_hint"),
    });
  }
  return out.length > 0 ? out : undefined;
}

function safeDataRequirements(v: unknown): DataRequirement[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: DataRequirement[] = [];
  for (const item of v) {
    const obj = record(item);
    if (!obj) continue;
    const data_id = safeString(obj.data_id).trim();
    const name = safeString(obj.name).trim();
    const purpose = safeString(obj.purpose).trim();
    if (!data_id || !name || !purpose) continue;
    out.push({
      data_id,
      name,
      purpose,
      required_values: safeStringArray(obj.required_values),
      source: optionalString(obj, "source"),
      refresh_policy: optionalString(obj, "refresh_policy"),
      permission: optionalString(obj, "permission"),
      empty_state: optionalString(obj, "empty_state"),
      notes: safeStringArray(obj.notes),
    });
  }
  return out.length > 0 ? out : undefined;
}

// Some tests inject `data_io`/`edge_cases` as a single string. The schema
// requires an array, but we preserve the original shape so downstream
// anti-hallucination can apply sentinel substitution before final coercion.
function arrayOrPassthrough(v: unknown): string[] | string {
  if (Array.isArray(v)) return safeStringArray(v);
  if (typeof v === "string") return v;
  return [];
}

// Placeholder used when the LLM does not return a value for a required
// non-empty string field. Schema (frame-description.schema.json) enforces
// minLength: 1 on intent/user_value/success_criteria/title; this single
// dash satisfies the contract while remaining visually distinct from real
// content for downstream PM review.
const PLACEHOLDER = "-";

export function defaultEntryShell(frame: FrameInput): ManifestEntry {
  return {
    screen_id: frame.screen_id,
    display_id: frame.screen_id,
    title: frame.frame_meta.name ?? frame.screen_id,
    intent: PLACEHOLDER,
    user_value: PLACEHOLDER,
    success_criteria: PLACEHOLDER,
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0,
    intent_mismatch: false,
    source_hash: frame.source_hash,
    write_target: "none" as WriteTarget,
    persona_tags: ["pm"] as PersonaTag[],
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function mergeLlmBody(shell: ManifestEntry, text: string): ManifestEntry {
  let parsed: ParsedLLMBody = {};
  try {
    parsed = JSON.parse(text) as ParsedLLMBody;
  } catch {
    /* non-JSON output yields shell-only entry; downstream low confidence */
  }
  const edge = arrayOrPassthrough(parsed.edge_cases);
  const dio = arrayOrPassthrough(parsed.data_io);
  const areaAnnotations = safeAreaAnnotations(parsed.area_annotations);
  const dataRequirements = safeDataRequirements(parsed.data_requirements);
  return {
    ...shell,
    intent: safeString(parsed.intent, shell.intent),
    user_value: safeString(parsed.user_value, shell.user_value),
    success_criteria: safeString(parsed.success_criteria, shell.success_criteria),
    states: safeStringArray(parsed.states),
    edge_cases: edge as unknown as string[],
    data_io: dio as unknown as string[],
    ...(areaAnnotations ? { area_annotations: areaAnnotations } : {}),
    ...(dataRequirements ? { data_requirements: dataRequirements } : {}),
    intent_mismatch:
      typeof parsed.intent_mismatch === "boolean"
        ? parsed.intent_mismatch
        : shell.intent_mismatch,
  };
}

export function frameTextSamples(frame: FrameInput): string[] {
  const samples: string[] = [];
  if (frame.frame_meta.name) samples.push(frame.frame_meta.name);
  for (const node of frame.frame_meta.text_nodes ?? []) {
    if (typeof node.content === "string") samples.push(node.content);
  }
  return samples;
}
