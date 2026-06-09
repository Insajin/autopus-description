// SPEC-FIGMA-019 T8 — write-router full-surface redactor unit (S3, S2).
//
// RED expectation: ../src/redactor.js does not yet export `redactExtendedTokens`
// or `redactExtendedObject` (added by T3). The import line resolves but the
// named bindings are `undefined`, so every assertion that calls them throws
// `redactExtendedTokens is not a function` — the expected RED failure mode.
//
// All secrets below are SYNTHETIC (matching acceptance.md S2/S3 exactly).
//
// Placeholder contract (per acceptance.md):
//   - Extended path (figd_/xoxb-/Bearer/abs-path via redactExtended*) → "***" (REDACTED, S3)
//   - Legacy path  (figd_/xoxb- only via redactTokens/redact)        → "<REDACTED>" (S2)

import { describe, it, expect } from "vitest";
import {
  redactExtendedTokens,
  redactExtendedObject,
  redactTokens,
  redact,
  redactObject,
} from "../src/redactor.js";

// Synthetic secrets (acceptance.md S1/S3).
const BEARER = "Bearer abc123def4567890";
const ABS_PATH = "/Users/reviewer/notes.txt";
const FIGD = "figd_ABCDEFGHIJKLMNOP01";
const XOXB = "xoxb-ABCDEFGH99";

describe("SPEC-FIGMA-019 S3 — redactExtendedTokens scrubs all four secret classes", () => {
  it("scrubs a Bearer token to the '***' placeholder", () => {
    const out = redactExtendedTokens(`auth ${BEARER} end`);
    expect(out).not.toContain(BEARER);
    expect(out).not.toContain("abc123def4567890");
    expect(out).toContain("***");
    // Non-secret context survives.
    expect(out).toContain("auth");
    expect(out).toContain("end");
  });

  it("scrubs an absolute privileged path to the '***' placeholder", () => {
    const out = redactExtendedTokens(`see ${ABS_PATH} please`);
    expect(out).not.toContain(ABS_PATH);
    expect(out).not.toContain("/Users/reviewer");
    expect(out).toContain("***");
    expect(out).toContain("see");
    expect(out).toContain("please");
  });

  it("still scrubs figd_ and xoxb- in the same pass (one pass covers four classes)", () => {
    const out = redactExtendedTokens(`${FIGD} and ${XOXB}`);
    expect(out).not.toContain(FIGD);
    expect(out).not.toContain(XOXB);
    expect(out).toContain("***");
  });

  // S3 exact oracle string from acceptance.md line 32.
  it("S3 oracle: 'ping Bearer ZZZ... then /home/svc/key and C:\\Users\\svc\\token.txt'", () => {
    const out = redactExtendedTokens(
      "ping Bearer ZZZ1234567890ABCDEF then /home/svc/key and C:\\Users\\svc\\token.txt",
    );
    expect(out).not.toContain("Bearer ZZZ1234567890ABCDEF");
    expect(out).not.toContain("/home/svc/");
    expect(out).not.toContain("C:\\Users\\svc");
    expect(out).toContain("***");
  });

  it("S3 oracle: a bare figd_ token also becomes '***' so all four classes share one pass", () => {
    const out = redactExtendedTokens(FIGD);
    expect(out).not.toContain(FIGD);
    expect(out).toContain("***");
  });
});

describe("SPEC-FIGMA-019 S3 — redactExtendedObject recurses arrays/objects", () => {
  it("recurses into nested objects and arrays scrubbing every secret class", () => {
    const input = {
      note: `${BEARER} here`,
      nested: { path: ABS_PATH, list: [FIGD, XOXB, "plain"] },
    };
    const out = redactExtendedObject(input) as {
      note: string;
      nested: { path: string; list: string[] };
    };
    expect(out.note).not.toContain(BEARER);
    expect(out.note).toContain("***");
    expect(out.nested.path).not.toContain(ABS_PATH);
    expect(out.nested.path).toContain("***");
    expect(out.nested.list[0]).not.toContain(FIGD);
    expect(out.nested.list[1]).not.toContain(XOXB);
    expect(out.nested.list[2]).toBe("plain");
  });

  it("returns non-string primitives unchanged", () => {
    expect(redactExtendedObject(42)).toBe(42);
    expect(redactExtendedObject(null)).toBe(null);
    expect(redactExtendedObject(true)).toBe(true);
  });
});

describe("SPEC-FIGMA-019 S2 — legacy redactor contract is preserved (figd_/xoxb- only, '<REDACTED>')", () => {
  it("redactObject scrubs figd_/xoxb- to '<REDACTED>' (S2 oracle)", () => {
    const out = redactObject({
      a: "token figd_ABCDEFGHIJKLMNOP01 x",
      b: "slack xoxb-ABCDEFGH99 y",
    }) as { a: string; b: string };
    expect(out.a).not.toContain("figd_ABCDEFGHIJKLMNOP01");
    expect(out.b).not.toContain("xoxb-ABCDEFGH99");
    expect(out.a).toContain("<REDACTED>");
    expect(out.b).toContain("<REDACTED>");
  });

  it("a plain string with no token is returned unchanged (S2)", () => {
    expect(redactObject("hello world")).toBe("hello world");
  });

  it("legacy redactTokens/redact leave Bearer and absolute paths UNTOUCHED (contract split)", () => {
    // The OLD functions intentionally do NOT widen their surface — only the
    // new redactExtended* functions scrub Bearer/abs-path.
    const withBearer = redactTokens(`auth ${BEARER} end`);
    expect(withBearer).toContain(BEARER);
    expect(withBearer).not.toContain("***");

    const withPath = redact(`see ${ABS_PATH}`);
    expect(withPath).toContain(ABS_PATH);
  });

  it("legacy redactTokens still scrubs figd_/xoxb- to '<REDACTED>' (unchanged)", () => {
    const out = redactTokens(`${FIGD} ${XOXB}`);
    expect(out).not.toContain(FIGD);
    expect(out).not.toContain(XOXB);
    expect(out).toContain("<REDACTED>");
    expect(out).not.toContain("***");
  });
});
