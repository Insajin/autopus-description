// SPEC-FIGMA-005 T11 / AC-S9: static-prefix lint regression suite.
// REQ-09, REQ-NFR-04. The cache_control region MUST contain only invariant
// text. Any frame-specific token leaking into the prefix invalidates the
// Anthropic prompt cache key and tanks the 30-frame cache_hit_ratio target.

import { describe, expect, it } from "vitest";

import {
  FENCE_SYSTEM_ADDENDUM,
  buildStaticPrefix,
  lintStaticPrefix,
} from "../../src/providers/static-prefix.js";

const SYSTEM_PROMPT = `You are a Figma frame description generator. Produce strict JSON conforming to the supplied schema. Do not add commentary.`;
const SCHEMA_INSTRUCTION = `Required keys: intent, user_value, success_criteria, states, edge_cases, data_io, intent_mismatch, confidence.`;

describe("static-prefix lint (AC-S9)", () => {
  it("clean prefix yields zero violations", () => {
    const prefix = buildStaticPrefix(SYSTEM_PROMPT, SCHEMA_INSTRUCTION);
    const res = lintStaticPrefix(prefix.text);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it("hostile prefix containing frame_meta token fails", () => {
    const hostile = `${SYSTEM_PROMPT}\n\nDEBUG: frame_meta = {...}\n${FENCE_SYSTEM_ADDENDUM}`;
    const res = lintStaticPrefix(hostile);
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("frame_meta");
  });

  it("hostile prefix containing 16-char hex sha256 substring fails", () => {
    const hostile = `${SYSTEM_PROMPT}\n\nlast_run_hash=0123456789abcdef\n${FENCE_SYSTEM_ADDENDUM}`;
    const res = lintStaticPrefix(hostile);
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("sha256_hex");
  });

  it("hostile prefix containing screen_id keyword fails", () => {
    const hostile = `${SYSTEM_PROMPT}\n\nCurrent screen_id under review.\n${FENCE_SYSTEM_ADDENDUM}`;
    const res = lintStaticPrefix(hostile);
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("screen_id");
  });

  it("multiple violations are all surfaced", () => {
    const hostile = `${SYSTEM_PROMPT}\n\nscreen_id=AUTH-01 source_hash=0123456789abcdef frame_meta={}`;
    const res = lintStaticPrefix(hostile);
    expect(res.ok).toBe(false);
    expect(res.violations).toEqual(
      expect.arrayContaining([
        "screen_id",
        "source_hash",
        "sha256_hex",
        "frame_meta",
      ]),
    );
  });

  it("FENCE_SYSTEM_ADDENDUM boilerplate is allowed in prefix (REQ-NFR-05)", () => {
    expect(FENCE_SYSTEM_ADDENDUM).toContain("<UNTRUSTED_DESIGN_TEXT");
    const prefix = buildStaticPrefix(SYSTEM_PROMPT, SCHEMA_INSTRUCTION);
    const res = lintStaticPrefix(prefix.text);
    // The boilerplate phrase `<UNTRUSTED_DESIGN_TEXT>...</UNTRUSTED_DESIGN_TEXT>`
    // is part of the addendum — it MUST NOT trigger a violation.
    expect(res.violations).not.toContain("untrusted_open_tag");
  });

  it("an injected open tag outside the boilerplate phrase fails", () => {
    const hostile = `${SYSTEM_PROMPT}\n\nleak: <UNTRUSTED_DESIGN_TEXT kind="x">payload</UNTRUSTED_DESIGN_TEXT>\n${FENCE_SYSTEM_ADDENDUM}`;
    const res = lintStaticPrefix(hostile);
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("untrusted_open_tag");
  });

  it("prefix builder is deterministic (cache key stability)", () => {
    const a = buildStaticPrefix(SYSTEM_PROMPT, SCHEMA_INSTRUCTION);
    const b = buildStaticPrefix(SYSTEM_PROMPT, SCHEMA_INSTRUCTION);
    expect(a.text).toBe(b.text);
    expect(a.tokens).toBe(b.tokens);
  });
});
