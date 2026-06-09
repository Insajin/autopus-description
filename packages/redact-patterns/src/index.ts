// SPEC-FIGMA-019 REQ-01 — relocated single source of truth for redact regex
// pattern source strings. Originally defined in `src/redact-patterns.ts`; moved
// here so that BOTH the root daemon tree (`src/daemon/redact-extended.ts`) AND
// the self-contained `packages/write-router` package can single-source the same
// strings without a layer inversion. `src/redact-patterns.ts` now re-exports
// these identifiers verbatim, so its existing importers are unchanged.
//
// FROZEN INVARIANTS (SPEC-FIGMA-007 NFR-04, preserved here byte-for-byte):
//   - `FIGD_PATTERN_SOURCE` MUST byte-equal `src/token-redactor.ts::TOKEN_PATTERN.source`
//   - `XOXB_PATTERN_SOURCE` MUST byte-equal the figd_/xoxb- regex the
//     write-router redactor reconstructs (no longer an inline literal — it is
//     now built from this string, removing the drift surface AC-S14 guarded).
//   - Drift is detected by `tests/unit/redact-patterns-parity.test.ts` and the
//     `tests/integration/figma-007/AC-S14.test.ts` integration oracle.
//
// Plain string exports (not RegExp) so plugin-side webcrypto/JS ports can
// reconstruct identical RegExp objects without losing byte-equivalence.

// @AX:NOTE: [AUTO] single source of truth for the four redact pattern classes; AC-S14 byte-equal parity (daemon + write-router + plugin port) depends on these strings staying frozen.
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

// @AX:NOTE: [AUTO] extended-surface placeholder `***` — distinct from write-router's legacy `<REDACTED>`; two intentional placeholders (SPEC-FIGMA-019 Completion Debt).
export const REDACTED = "***";
