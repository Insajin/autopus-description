// SPEC-FIGMA-007 NFR-03 — coverage edge-case tests for redact-extended.
// The audit-retention-guard tests cover redactExtended via the writer path;
// this file exercises redactExtendedObject (recursive structural redaction).

import { describe, it, expect } from "vitest";

import {
  redactExtended,
  redactExtendedObject,
  EXTENDED_REDACT_PATTERNS,
} from "../../src/daemon/redact-extended.js";

describe("redactExtended — string-level scrub", () => {
  it("strips figd_, xoxb-, bearer, and absolute-path tokens in one pass", () => {
    const input =
      "leak figd_AAAAAAAAAAAAAAAA and xoxb-12345678 and Bearer aaaaaaaaaaaaaaaaaa from /Users/secret/path";
    const out = redactExtended(input);
    expect(out).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
    expect(out).not.toMatch(/xoxb-[A-Za-z0-9_-]{8,}/);
    expect(out).not.toMatch(/[Bb]earer [A-Za-z0-9._-]{16,}/);
    expect(out).not.toMatch(/\/Users\//);
  });

  it("returns input unchanged when there are no sensitive tokens", () => {
    expect(redactExtended("plain text only")).toBe("plain text only");
  });

  it("non-string input is returned as-is (defensive guard branch)", () => {
    // The function signature is string but the runtime guard returns whatever
    // is passed when typeof !== "string" — exercise that branch.
    const numericInput = 42 as unknown as string;
    expect(redactExtended(numericInput)).toBe(numericInput);
  });
});

describe("redactExtendedObject — recursive structural redaction", () => {
  it("scrubs strings inside nested objects", () => {
    const obj = {
      top: "figd_AAAAAAAAAAAAAAAA",
      nested: { mid: "xoxb-1234567890123456" },
    };
    const out = redactExtendedObject(obj) as Record<string, unknown>;
    expect(out.top).not.toMatch(/figd_/);
    const nested = out.nested as Record<string, unknown>;
    expect(nested.mid).not.toMatch(/xoxb-/);
  });

  it("scrubs strings inside arrays", () => {
    const arr = ["safe", "Bearer aaaaaaaaaaaaaaaaaa", { x: "/Users/me" }];
    const out = redactExtendedObject(arr) as unknown[];
    expect(out[0]).toBe("safe");
    expect(out[1]).not.toMatch(/[Bb]earer/);
    expect((out[2] as Record<string, unknown>).x).not.toMatch(/\/Users\//);
  });

  it("preserves non-string primitives (number, boolean, null) unchanged", () => {
    expect(redactExtendedObject(42)).toBe(42);
    expect(redactExtendedObject(true)).toBe(true);
    expect(redactExtendedObject(null)).toBe(null);
    expect(redactExtendedObject(undefined)).toBe(undefined);
  });

  it("handles deeply nested mixed structures", () => {
    const deep = {
      a: [
        { b: { c: "figd_AAAAAAAAAAAAAAAA", d: 1 } },
        ["xoxb-1234567890123456", null, false],
      ],
      e: "/home/secret",
    };
    const out = JSON.stringify(redactExtendedObject(deep));
    expect(out).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
    expect(out).not.toMatch(/xoxb-[A-Za-z0-9_-]{8,}/);
    expect(out).not.toMatch(/\/home\//);
    // Numbers and booleans preserved.
    expect(out).toMatch(/"d":1/);
    expect(out).toMatch(/false/);
  });

  it("EXTENDED_REDACT_PATTERNS exposes runtime regex objects with correct sources", () => {
    expect(EXTENDED_REDACT_PATTERNS.figd).toBeInstanceOf(RegExp);
    expect(EXTENDED_REDACT_PATTERNS.xoxb).toBeInstanceOf(RegExp);
    expect(EXTENDED_REDACT_PATTERNS.bearer).toBeInstanceOf(RegExp);
    expect(Array.isArray(EXTENDED_REDACT_PATTERNS.absolutePaths)).toBe(true);
    expect(EXTENDED_REDACT_PATTERNS.absolutePaths.length).toBe(3);
  });
});
