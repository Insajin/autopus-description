// SPEC-FIGMA-019 REQ-01 — re-export shim. The redact pattern source strings
// were relocated to the shared `@autopus/redact-patterns` workspace package so
// that the self-contained `packages/write-router` package can single-source the
// same strings without importing from the root daemon `src/` tree (which would
// be a layer inversion). This file preserves EVERY existing export identifier
// and value so the current importers keep working with no import-path change:
//   - src/daemon/redact-extended.ts
//   - vendor/.../cursor_mcp_plugin/autopus_redact.ts
//   - tests/unit/redact-patterns-parity.test.ts
//   - tests/integration/figma-007/AC-S14.test.ts
//   - tests/integration/figma-007/AC-S7.test.ts
//   - tests/unit/daemon-audit-retention-guard.test.ts
//   - src/daemon/tests/apply-tool-native-annotation-redaction.test.ts
//
// FROZEN INVARIANTS (SPEC-FIGMA-007 NFR-04) are documented at the new source of
// truth: packages/redact-patterns/src/index.ts.

export {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
  REDACTED,
} from "@autopus/redact-patterns";
