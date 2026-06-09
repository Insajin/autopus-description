// SPEC-FIGMA-004 / SPEC-FIGMA-019 — write-router redactor.
//
// Two contracts coexist in this file, bound to two different placeholders:
//
//   1. LEGACY (frozen, SPEC-FIGMA-007 AC-S14): `redactTokens`/`redactObject`/
//      `redact` scrub ONLY figd_/xoxb- tokens to the `<REDACTED>` placeholder.
//      Their regex is now RECONSTRUCTED from the shared FIGD_/XOXB_PATTERN_SOURCE
//      strings instead of an inline literal — this removes the inline-drift
//      surface the AC-S14 parity test previously guarded textually. Behavior is
//      unchanged; the placeholder stays `<REDACTED>`.
//
//   2. EXTENDED (SPEC-FIGMA-019): `redactExtendedTokens`/`redactExtendedObject`
//      scrub all FOUR secret classes (figd_/xoxb-/Bearer/absolute-path) to the
//      shared `***` placeholder (REDACTED from @autopus/redact-patterns),
//      mirroring `src/daemon/redact-extended.ts`'s regex construction but inside
//      the package boundary — no import from the root daemon `src/` tree.

import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
  REDACTED as EXTENDED_REDACTED,
} from "@autopus/redact-patterns";

// @AX:NOTE: [AUTO] placeholder split is intentional — legacy figd_/xoxb- path emits `<REDACTED>` (frozen AC-S14) while the extended path emits `***` from @autopus/redact-patterns; do not unify them.
// Legacy placeholder — distinct from the extended `***` (intentional, two
// source-of-truth placeholders; see SPEC-FIGMA-019 Completion Debt).
const LEGACY_REDACTED = "<REDACTED>";

// Reconstruct the legacy combined figd_/xoxb- regex from the shared source
// strings (was an inline `/(figd_...|xoxb-...)/g` literal before SPEC-FIGMA-019).
const TOKEN_REGEX = new RegExp(
  `(${FIGD_PATTERN_SOURCE}|${XOXB_PATTERN_SOURCE})`,
  "g",
);

export function redactTokens(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  return input.replace(TOKEN_REGEX, LEGACY_REDACTED);
}

export function redactObject(value: unknown): unknown {
  if (typeof value === "string") return redactTokens(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactObject(v);
    }
    return out;
  }
  return value;
}

export const redact = redactTokens;

// --- SPEC-FIGMA-019 extended (full-surface) redactor ----------------------

// Built from the same shared source strings, mirroring redact-extended.ts.
const FIGD_RE = new RegExp(FIGD_PATTERN_SOURCE, "g");
const XOXB_RE = new RegExp(XOXB_PATTERN_SOURCE, "g");
const BEARER_RE = new RegExp(BEARER_PATTERN_SOURCE, "g");

// Each absolute-path entry matches `<prefix><segment>` so the scrubbed output
// leaks neither the privileged-path prefix nor the following name segment.
const ABSOLUTE_PATH_REGEXES: RegExp[] = ABSOLUTE_PATH_PATTERNS_SOURCE.map(
  (src) => new RegExp(`${src}[^/\\\\\\s]*`, "g"),
);

// @AX:WARN: [AUTO] security redaction boundary — order and exhaustiveness of the four passes (figd_/xoxb-/Bearer/absolute-path) determine whether a secret leaks; an unscrubbed class here reaches the HTTP undo_descriptor response.
// @AX:REASON: this is the only scrub between untrusted captured text and the in-memory UndoRegistry / HTTP body; a missed class is a silent secret disclosure (REQ-03/REQ-05).
// @AX:NOTE: [AUTO] regexes are single-sourced from @autopus/redact-patterns (AC-S14 byte-equal parity with daemon redact-extended.ts) — do not inline literals here.
export function redactExtendedTokens(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  let out = input.replace(FIGD_RE, EXTENDED_REDACTED);
  out = out.replace(XOXB_RE, EXTENDED_REDACTED);
  out = out.replace(BEARER_RE, EXTENDED_REDACTED);
  for (const re of ABSOLUTE_PATH_REGEXES) {
    out = out.replace(re, EXTENDED_REDACTED);
  }
  return out;
}

export function redactExtendedObject(value: unknown): unknown {
  if (typeof value === "string") return redactExtendedTokens(value);
  if (Array.isArray(value)) return value.map(redactExtendedObject);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactExtendedObject(v);
    }
    return out;
  }
  return value;
}
