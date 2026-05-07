// SPEC-FIGMA-007 T21, REQ-21, AC-S14 — redact regex parity oracle.
// Asserts the single source of truth `src/redact-patterns.ts` does not drift
// from the frozen pattern literals embedded in:
//   - src/token-redactor.ts        (frozen by NFR-04, figd_ only)
//   - packages/write-router/src/redactor.ts (frozen by NFR-04, figd_ + xoxb-)
// Drift in either frozen file fails this test with a clear file-named message.

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

  it("packages/write-router/src/redactor.ts inline regex source byte-equals (FIGD|XOXB) shared sources", () => {
    const src = readSource("packages/write-router/src/redactor.ts");
    // Match the first RegExp literal: `/(figd_...|xoxb-...)/g`
    const m = src.match(/\/\(figd_\[[^]+?\]\{[^}]+?\}\|xoxb-\[[^]+?\]\{[^}]+?\}\)\/g/);
    if (!m) {
      throw new Error(
        "redact pattern drift: packages/write-router/src/redactor.ts no longer contains the expected combined figd_/xoxb- regex literal — update the parity test or revert the frozen file",
      );
    }
    const literal = m[0];
    // Inner alternation parts. Reconstruct the two source strings.
    const inner = literal.slice(2, -3); // strip `/(` ... `)/g`
    const [figdPart, xoxbPart] = inner.split("|");
    if (figdPart !== FIGD_PATTERN_SOURCE) {
      throw new Error(
        `redact pattern drift: packages/write-router/src/redactor.ts FIGD pattern diverges from src/redact-patterns.ts — got ${figdPart} vs ${FIGD_PATTERN_SOURCE}`,
      );
    }
    if (xoxbPart !== XOXB_PATTERN_SOURCE) {
      throw new Error(
        `redact pattern drift: packages/write-router/src/redactor.ts XOXB pattern diverges from src/redact-patterns.ts — got ${xoxbPart} vs ${XOXB_PATTERN_SOURCE}`,
      );
    }
    expect(figdPart).toBe(FIGD_PATTERN_SOURCE);
    expect(xoxbPart).toBe(XOXB_PATTERN_SOURCE);
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
