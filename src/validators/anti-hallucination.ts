// SPEC-FIGMA-003 T9: Anti-hallucination post-hoc validator.
// Replace [CANNOT_INFER] sentinel with empty string; cap confidence at 0.5
// when any sentinel was found (REQ-09 / INV-005).

import type { ManifestEntry } from "../types/llm-provider.js";

const SENTINEL = "[CANNOT_INFER]";
const CONFIDENCE_CAP = 0.5;

// Match exact sentinel OR sentinel-prefixed prose ("[CANNOT_INFER] but I think...").
// Case-sensitive per plan T9 ("case-sensitive, trim 후 비교").
function isSentinel(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === SENTINEL || trimmed.startsWith(`${SENTINEL} `);
}

function sanitizeString(value: string): { cleaned: string; tripped: boolean } {
  if (isSentinel(value)) return { cleaned: "", tripped: true };
  return { cleaned: value, tripped: false };
}

function sanitizeArray(values: string[]): { cleaned: string[]; tripped: boolean } {
  let tripped = false;
  const cleaned: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") {
      cleaned.push(v);
      continue;
    }
    if (isSentinel(v)) {
      tripped = true;
      continue;
    }
    cleaned.push(v);
  }
  return { cleaned, tripped };
}

export function applyAntiHallucination(entry: ManifestEntry): ManifestEntry {
  const out: ManifestEntry = { ...entry };
  let anyTripped = false;

  // Free-text scalar fields per plan T9.
  for (const field of ["intent", "user_value", "success_criteria"] as const) {
    const v = out[field];
    if (typeof v === "string") {
      const { cleaned, tripped } = sanitizeString(v);
      out[field] = cleaned;
      anyTripped = anyTripped || tripped;
    }
  }

  // Array fields per schema. The LLM may emit a single string when it can't
  // articulate the field (often paired with a sentinel). Always coerce to
  // array form on the way out so the manifest is schema-shaped: sentinel →
  // [], non-sentinel-string → [string], array → filtered array.
  for (const field of ["edge_cases", "data_io"] as const) {
    const v = out[field] as unknown;
    if (Array.isArray(v)) {
      const { cleaned, tripped } = sanitizeArray(v);
      out[field] = cleaned;
      anyTripped = anyTripped || tripped;
    } else if (typeof v === "string") {
      if (isSentinel(v)) {
        out[field] = [];
        anyTripped = true;
      } else if (v.length > 0) {
        out[field] = [v];
      } else {
        out[field] = [];
      }
    }
  }

  if (anyTripped && out.confidence > CONFIDENCE_CAP) {
    out.confidence = CONFIDENCE_CAP;
  }
  return out;
}

export const ANTI_HALLUCINATION = {
  SENTINEL,
  CONFIDENCE_CAP,
} as const;
