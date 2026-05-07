// SPEC-FIGMA-007 REQ-21, NFR-03 — single source of truth for redact regex
// pattern source strings shared across:
//   - daemon-side `src/daemon/redact-extended.ts` (audit retention guard)
//   - plugin-side `vendor/.../autopus_redact.ts` (plugin postMessage redact)
//   - parity test `tests/unit/redact-patterns-parity.test.ts`
//
// FROZEN INVARIANTS (NFR-04):
//   - `FIGD_PATTERN_SOURCE` MUST byte-equal `src/token-redactor.ts::TOKEN_PATTERN.source`
//   - `XOXB_PATTERN_SOURCE` MUST byte-equal the figd_/xoxb- regex literal
//     embedded in `packages/write-router/src/redactor.ts` (currently inline)
//   - Drift in any of the above is detected by `redact-patterns-parity.test.ts`
//
// Plain string exports (not RegExp) so plugin-side webcrypto/JS port can
// reconstruct identical RegExp objects without losing byte-equivalence.

export const FIGD_PATTERN_SOURCE = "figd_[A-Za-z0-9_-]{16,}";

// Slack bot token; write-router/redactor.ts uses {8,} repetition (8+ chars
// after the `xoxb-` prefix). The shared source string MUST byte-equal that
// literal so the parity test passes against the frozen file.
export const XOXB_PATTERN_SOURCE = "xoxb-[A-Za-z0-9_-]{8,}";

// Bearer token: `Bearer ` (case-insensitive) followed by 16+ token chars.
// Used by daemon-side audit retention guard to strip OAuth/JWT bearer values
// from raw `prompt_text` / `response_text` retained under DEBUG=true.
export const BEARER_PATTERN_SOURCE = "[Bb]earer [A-Za-z0-9._\\-]{16,}";

// Absolute privileged path prefixes. Each entry is a literal path prefix the
// redact extender treats as a path-anchored match (escaped backslash for
// Windows Users path). Frozen as ordered list — element-wise byte equality
// asserted by the parity test against the plugin port.
export const ABSOLUTE_PATH_PATTERNS_SOURCE: readonly string[] = [
  "/Users/",
  "/home/",
  "C:\\\\Users\\\\",
] as const;

export const REDACTED = "***";
