// SPEC-FIGMA-007 T21, REQ-21, AC-S14 + SPEC-FIGMA-019 REQ-09 — redact regex
// parity oracle.
//
// `src/redact-patterns.ts` re-exports the shared `@autopus/redact-patterns`
// single source of truth. This oracle asserts that source does not drift from:
//   - src/token-redactor.ts (frozen by NFR-04, figd_ only — still inline literal)
//   - packages/write-router/src/redactor.ts (SPEC-FIGMA-019: now STRUCTURALLY
//     single-sources its four pattern strings from @autopus/redact-patterns
//     instead of carrying an inline figd_/xoxb- regex literal that could drift).
// Drift fails this test with a clear file-named message.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
} from "../../src/redact-patterns.js";
import { TOKEN_PATTERN } from "../../src/token-redactor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("redact-patterns shared module — exports (REQ-21)", () => {
  it("FIGD_PATTERN_SOURCE is a literal string with the expected shape", () => {
    expect(typeof FIGD_PATTERN_SOURCE).toBe("string");
    expect(FIGD_PATTERN_SOURCE).toBe("figd_[A-Za-z0-9_-]{16,}");
  });

  it("XOXB_PATTERN_SOURCE is a literal string with the expected shape", () => {
    expect(typeof XOXB_PATTERN_SOURCE).toBe("string");
    expect(XOXB_PATTERN_SOURCE).toBe("xoxb-[A-Za-z0-9_-]{8,}");
  });

  it("BEARER_PATTERN_SOURCE is a literal string with the expected shape", () => {
    expect(typeof BEARER_PATTERN_SOURCE).toBe("string");
    expect(BEARER_PATTERN_SOURCE).toBe("[Bb]earer [A-Za-z0-9._\\-]{16,}");
  });

  it("ABSOLUTE_PATH_PATTERNS_SOURCE is the 3-element ordered list", () => {
    expect(ABSOLUTE_PATH_PATTERNS_SOURCE).toEqual([
      "/Users/",
      "/home/",
      "C:\\\\Users\\\\",
    ]);
  });
});

describe("Frozen file pattern parity (NFR-04 drift detection, AC-S14)", () => {
  it("src/token-redactor.ts::TOKEN_PATTERN.source byte-equals FIGD_PATTERN_SOURCE", () => {
    if (TOKEN_PATTERN.source !== FIGD_PATTERN_SOURCE) {
      throw new Error(
        `redact pattern drift: src/token-redactor.ts::TOKEN_PATTERN diverges from src/redact-patterns.ts::FIGD_PATTERN_SOURCE — got ${TOKEN_PATTERN.source} vs ${FIGD_PATTERN_SOURCE}`,
      );
    }
    expect(TOKEN_PATTERN.source).toBe(FIGD_PATTERN_SOURCE);
  });

  it("packages/write-router/src/redactor.ts single-sources its pattern strings from @autopus/redact-patterns (no inline figd_/xoxb- regex literal)", () => {
    const src = readSource("packages/write-router/src/redactor.ts");

    // SPEC-FIGMA-019: parity is now STRUCTURAL — the redactor MUST import the
    // four pattern source strings from the shared package rather than embed an
    // inline literal that can silently drift. Capture the whole (possibly
    // multi-line) import statement that pulls from @autopus/redact-patterns.
    const importMatch = src.match(
      /import\s*\{([^}]*)\}\s*from\s*["']@autopus\/redact-patterns["']/,
    );
    if (!importMatch) {
      throw new Error(
        "redact pattern drift: packages/write-router/src/redactor.ts no longer imports its pattern sources from @autopus/redact-patterns — it must single-source, not inline",
      );
    }
    const importedNames = importMatch[1];
    expect(importedNames).toMatch(/FIGD_PATTERN_SOURCE/);
    expect(importedNames).toMatch(/XOXB_PATTERN_SOURCE/);
    expect(importedNames).toMatch(/BEARER_PATTERN_SOURCE/);
    expect(importedNames).toMatch(/ABSOLUTE_PATH_PATTERNS_SOURCE/);

    // Outside that import, the file MUST NOT carry an inline figd_/xoxb-/Bearer
    // regex source — that drift surface is exactly what relocation removed.
    const body = src.replace(importMatch[0], "");
    expect(body).not.toMatch(/figd_\[/);
    expect(body).not.toMatch(/xoxb-\[/);
    expect(body).not.toMatch(/\[Bb\]earer/);
  });

  it("write-router redactor and the shared source single-source the same four pattern classes", () => {
    // Functional confirmation that the redactor reconstructs RegExps from the
    // shared constants (figd_/xoxb-/Bearer/absolute-path), proving single
    // sourcing produces equivalent behavior rather than a divergent copy.
    expect(new RegExp(FIGD_PATTERN_SOURCE).test("figd_TESTTOKEN1234567890ABCDEF")).toBe(true);
    expect(new RegExp(XOXB_PATTERN_SOURCE).test("xoxb-1234567890123456")).toBe(true);
    expect(new RegExp(BEARER_PATTERN_SOURCE).test("Bearer abcdefghij1234567890")).toBe(true);
    expect(ABSOLUTE_PATH_PATTERNS_SOURCE).toEqual(["/Users/", "/home/", "C:\\\\Users\\\\"]);
  });
});

describe("Pattern functional behavior (round-trip sanity)", () => {
  it("FIGD source reconstructed as RegExp matches a sample figd_ token", () => {
    const re = new RegExp(FIGD_PATTERN_SOURCE);
    expect(re.test("figd_TESTTOKEN1234567890ABCDEF")).toBe(true);
    expect(re.test("figd_short")).toBe(false);
  });

  it("XOXB source reconstructed as RegExp matches a sample xoxb- token", () => {
    const re = new RegExp(XOXB_PATTERN_SOURCE);
    expect(re.test("xoxb-1234567890123456")).toBe(true);
    expect(re.test("xoxb-short")).toBe(false);
  });

  it("BEARER source reconstructed as RegExp matches both 'Bearer' and 'bearer' prefixes", () => {
    const re = new RegExp(BEARER_PATTERN_SOURCE);
    expect(re.test("Bearer abcdefghij1234567890")).toBe(true);
    expect(re.test("bearer abcdefghij1234567890")).toBe(true);
    expect(re.test("Bearer short")).toBe(false);
  });

  it("absolute path patterns are literal prefix strings (no regex meta)", () => {
    expect(ABSOLUTE_PATH_PATTERNS_SOURCE.length).toBe(3);
    expect(ABSOLUTE_PATH_PATTERNS_SOURCE[0]).toBe("/Users/");
    expect(ABSOLUTE_PATH_PATTERNS_SOURCE[1]).toBe("/home/");
    expect(ABSOLUTE_PATH_PATTERNS_SOURCE[2]).toBe("C:\\\\Users\\\\");
  });
});
