// SPEC-FIGMA-005 T3: cache_control static prefix builder + lint surface.
// Surfaces the exact text that ships under cache_control: {type: "ephemeral"}
// so it can be validated against frame-specific token leakage (REQ-09,
// REQ-NFR-04, REQ-NFR-05). The static prefix MUST contain only invariant
// text (system prompt + schema instruction + fence boilerplate). Adding any
// frame-specific token to this region invalidates the prompt cache key and
// destroys the cache_hit_ratio target (≥ 0.5 over a 30-frame run).

import { FENCE_SYSTEM_ADDENDUM } from "../prompts/untrusted-fence.js";

export interface StaticPrefix {
  text: string;
  // Approximate token count (4 chars/token offline baseline). Used by audit
  // to attribute cache_creation_input_tokens vs dynamic_input_tokens splits.
  tokens: number;
}

/**
 * Compose the cache_control region. Must be deterministic — same inputs
 * MUST produce byte-identical text so the Anthropic cache key remains
 * stable across the 30-frame batch.
 *
 * Inputs are validated against the lint regex set in lintStaticPrefix
 * before the build is allowed to ship (vitest hard gate, AC-S9).
 */
export function buildStaticPrefix(
  systemPrompt: string,
  schemaInstruction: string,
): StaticPrefix {
  const text = [
    systemPrompt.trim(),
    "",
    schemaInstruction.trim(),
    "",
    FENCE_SYSTEM_ADDENDUM,
  ].join("\n");
  return {
    text,
    tokens: Math.ceil(text.length / 4),
  };
}

export interface LintResult {
  ok: boolean;
  violations: string[];
}

// Regex set for REQ-09 frame-specific token detection. Each entry:
//   pattern  — RegExp matched against the cache_control text
//   label    — human-readable name surfaced in violation list
//   exclude  — substring that, if matched simultaneously, suppresses the
//              violation (e.g. `<UNTRUSTED_DESIGN_TEXT` appears in
//              FENCE_SYSTEM_ADDENDUM as boilerplate referring to the fence
//              shape, NOT as a leaked open tag from frame data).
interface PatternRule {
  pattern: RegExp;
  label: string;
  excludeIfContext?: RegExp;
}

const PATTERN_RULES: PatternRule[] = [
  {
    pattern: /\bscreen_id\b/g,
    label: "screen_id",
  },
  {
    pattern: /\bsource_hash\b/g,
    label: "source_hash",
  },
  {
    pattern: /\bdisplay_id\b/g,
    label: "display_id",
  },
  {
    // SHA-256 hex substring of length ≥ 16. Hex chars only — distinguishes
    // accidental hash leakage from natural English/Korean prose.
    pattern: /\b[a-f0-9]{16,}\b/g,
    label: "sha256_hex",
  },
  {
    pattern: /\bframe_meta\b/g,
    label: "frame_meta",
  },
  {
    // <UNTRUSTED_DESIGN_TEXT open tag — the boilerplate FENCE_SYSTEM_ADDENDUM
    // references this string as an instruction to the model. The prefix MUST
    // NOT contain a wrapped untrusted block (that belongs in the dynamic
    // user-content region only, REQ-NFR-05).
    // Suppress when the surrounding context is the boilerplate's own
    // explanatory phrase.
    pattern: /<UNTRUSTED_DESIGN_TEXT/g,
    label: "untrusted_open_tag",
    excludeIfContext: /<UNTRUSTED_DESIGN_TEXT>\.\.\.<\/UNTRUSTED_DESIGN_TEXT>/,
  },
];

/**
 * Inspect the cache_control prefix for any frame-specific token that would
 * invalidate the cache key. Returns a list of every token label found at
 * least once. Empty list ⇒ ok: true.
 *
 * The lint runs as part of the vitest suite (AC-S9). A non-empty violations
 * list fails the build before commit (REQ-09 gate).
 */
export function lintStaticPrefix(prefix: string): LintResult {
  const violations: string[] = [];
  for (const rule of PATTERN_RULES) {
    const matches = prefix.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    if (rule.excludeIfContext && rule.excludeIfContext.test(prefix)) {
      // Boilerplate context mentions the tag shape — count occurrences inside
      // the boilerplate phrase as benign. Any occurrence outside the
      // boilerplate context still counts.
      const boilerplateMatches = prefix.match(
        /<UNTRUSTED_DESIGN_TEXT>\.\.\.<\/UNTRUSTED_DESIGN_TEXT>/g,
      );
      const boilerplateCount = boilerplateMatches?.length ?? 0;
      if (matches.length > boilerplateCount) {
        violations.push(rule.label);
      }
      continue;
    }
    violations.push(rule.label);
  }
  return { ok: violations.length === 0, violations };
}

// Re-export FENCE_SYSTEM_ADDENDUM so static-prefix consumers can compose it
// directly without an additional import path. The boilerplate is part of
// the cache_control region by design (REQ-NFR-05).
export { FENCE_SYSTEM_ADDENDUM };
