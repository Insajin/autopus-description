/**
 * SPEC-FIGMA-008 Phase 3 — file-level coverage tests for token-redactor.ts.
 *
 * `redactTunnelUrl` (FIGMA-008 surface) is already covered by
 * `tests/unit/token-redactor-tunnel-url.test.ts`. This file fills the
 * pre-existing FIGMA-002 surface (`redactJsonValue`, `wrapStream`,
 * `countTokenMatches`) so that the file-level coverage threshold
 * (NFR-06 ≥85%) is met after FIGMA-008 added a new export.
 *
 * `runReadAdapterWithCapture` is excluded — it dynamically imports
 * `read-pipeline.ts` which would pull in the entire generation runtime.
 * That single 4-line wrapper drops the per-file numbers slightly but
 * cannot be exercised hermetically without booting the full pipeline.
 */

import { describe, it, expect } from "vitest";

import {
  countTokenMatches,
  redactJsonValue,
  wrapStream,
  redact,
  type WritableLike,
} from "../../src/token-redactor.js";

describe("countTokenMatches", () => {
  it("returns 0 for text without figd_ tokens", () => {
    expect(countTokenMatches("plain text")).toBe(0);
  });
  it("returns the number of figd_ matches", () => {
    expect(countTokenMatches("figd_AAAAAAAAAAAAAAAA and figd_BBBBBBBBBBBBBBBB")).toBe(2);
  });
});

describe("redactJsonValue", () => {
  it("returns null and undefined unchanged", () => {
    expect(redactJsonValue(null)).toBeNull();
    expect(redactJsonValue(undefined)).toBeUndefined();
  });
  it("redacts figd_ in string values", () => {
    expect(redactJsonValue("figd_AAAAAAAAAAAAAAAA")).toBe("***");
  });
  it("returns numbers/booleans unchanged (non-object, non-string primitives)", () => {
    expect(redactJsonValue(42)).toBe(42);
    expect(redactJsonValue(true)).toBe(true);
  });
  it("recursively redacts arrays of strings", () => {
    expect(redactJsonValue(["safe", "figd_AAAAAAAAAAAAAAAA"])).toEqual(["safe", "***"]);
  });
  it("recursively redacts nested objects", () => {
    const out = redactJsonValue({
      a: "safe",
      b: { c: "figd_AAAAAAAAAAAAAAAA", d: [1, "figd_BBBBBBBBBBBBBBBB"] },
    });
    expect(out).toEqual({ a: "safe", b: { c: "***", d: [1, "***"] } });
  });
});

describe("wrapStream", () => {
  it("redacts string chunks before forwarding to underlying write", () => {
    const captured: string[] = [];
    const fake: WritableLike = {
      write(chunk) {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    };
    const wrapped = wrapStream(fake);
    wrapped.write("leak figd_AAAAAAAAAAAAAAAA tail");
    expect(captured).toEqual(["leak *** tail"]);
  });

  it("redacts Uint8Array chunks (binary path) before forwarding", () => {
    const captured: string[] = [];
    const fake: WritableLike = {
      write(chunk) {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    };
    const wrapped = wrapStream(fake);
    wrapped.write(Buffer.from("bin figd_AAAAAAAAAAAAAAAA end") as unknown as Uint8Array);
    expect(captured).toEqual(["bin *** end"]);
  });
});

describe("redact (existing FIGMA-002 surface — sanity)", () => {
  it("replaces figd_ tokens with ***", () => {
    expect(redact("a figd_AAAAAAAAAAAAAAAA b")).toBe("a *** b");
  });
});
