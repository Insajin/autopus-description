// SPEC-FIGMA-003 T-PI: Post-hoc prompt-injection heuristic detector.
// Runs AFTER anti-hallucination so empty-string fields from [CANNOT_INFER]
// do not trip the marker checks.

import type { ManifestEntry } from "../types/llm-provider.js";

const INJECTED_MARKER_RE = /__INJECTED__/i;
const SYSTEM_OVERRIDE_RE =
  /\[(SYSTEM|ADMIN)\]|ignore (previous|prior) instructions|set confidence to|disregard the (above|prior)/i;

export interface InjectionDetectionInput {
  frameTextSamples: string[];
}

export interface InjectionDetectionResult {
  suspected: boolean;
  markers: string[];
}

function freeTextFields(entry: ManifestEntry): string[] {
  const fields: string[] = [];
  for (const key of ["intent", "user_value", "success_criteria"] as const) {
    const v = entry[key];
    if (typeof v === "string") fields.push(v);
  }
  for (const key of ["edge_cases", "data_io"] as const) {
    const v = entry[key] as unknown;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") fields.push(item);
      }
    } else if (typeof v === "string") {
      fields.push(v);
    }
  }
  return fields;
}

export function detectInjection(
  entry: ManifestEntry,
  input: InjectionDetectionInput,
): InjectionDetectionResult {
  const markers: string[] = [];

  // (a) literal __INJECTED__ in any output free-text field.
  if (freeTextFields(entry).some((s) => INJECTED_MARKER_RE.test(s))) {
    markers.push("__INJECTED__");
  }

  // (b) confidence pinned to 1.0 (model "agreed" to whatever the input said).
  if (entry.confidence === 1.0) {
    markers.push("confidence==1.0");
  }

  // (c) any input frame text matched a system-override pattern.
  for (const sample of input.frameTextSamples) {
    if (SYSTEM_OVERRIDE_RE.test(sample)) {
      markers.push("input_pattern:[SYSTEM]");
      break;
    }
  }

  // The dual-provider oracle (AC-S14) requires ALL THREE markers to be
  // present before flagging — a compliant model that returns a benign
  // intent with confidence 0.62 must NOT trip even though the input
  // contains an injection payload.
  const suspected =
    markers.includes("__INJECTED__") &&
    markers.includes("confidence==1.0") &&
    markers.includes("input_pattern:[SYSTEM]");

  return { suspected, markers: suspected ? markers : [] };
}

export const INJECTION_PATTERNS = {
  INJECTED_MARKER: INJECTED_MARKER_RE,
  SYSTEM_OVERRIDE: SYSTEM_OVERRIDE_RE,
} as const;
