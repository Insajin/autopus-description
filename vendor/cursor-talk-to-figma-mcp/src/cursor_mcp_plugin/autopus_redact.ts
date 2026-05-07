// SPEC-FIGMA-007 REQ-13, REQ-21, AC-S14 — plugin-side redact port.
//
// Imports its pattern source strings from `src/redact-patterns.ts` (single
// source of truth). MUST NOT define inline regex literals for figd_/xoxb-/
// bearer/absolute-path patterns — AC-S14 grep guard fails this test if
// any inline literal is present in the file body.

import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
  REDACTED,
} from "../../../../../src/redact-patterns.js";

const FIGD_RE = new RegExp(FIGD_PATTERN_SOURCE, "g");
const XOXB_RE = new RegExp(XOXB_PATTERN_SOURCE, "g");
const BEARER_RE = new RegExp(BEARER_PATTERN_SOURCE, "g");
const ABSOLUTE_PATH_REGEXES: RegExp[] = ABSOLUTE_PATH_PATTERNS_SOURCE.map(
  (src) => new RegExp(`${src}[^/\\\\\\s]*`, "g"),
);

export function autopusRedact(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  let out = input.replace(FIGD_RE, REDACTED);
  out = out.replace(XOXB_RE, REDACTED);
  out = out.replace(BEARER_RE, REDACTED);
  for (const re of ABSOLUTE_PATH_REGEXES) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

export function autopusRedactObject(value: unknown): unknown {
  if (typeof value === "string") return autopusRedact(value);
  if (Array.isArray(value)) return value.map(autopusRedactObject);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = autopusRedactObject(v);
    }
    return out;
  }
  return value;
}

// Re-exports kept for AC-S14 daemon-vs-plugin parity assertion.
export {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
};
