/**
 * Coverage gap — src/source-hash.ts (canonicalJson edge cases, imageBytesSha256)
 */
import { describe, it, expect } from "vitest";
import { canonicalJson, sha256Hex, imageBytesSha256 } from "../src/source-hash.js";

describe("canonicalJson — coverage of all type branches", () => {
  it("null becomes 'null'", () => {
    expect(canonicalJson(null)).toBe("null");
  });

  it("booleans become 'true' / 'false'", () => {
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
  });

  it("integers render as bare numbers", () => {
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(-7)).toBe("-7");
    expect(canonicalJson(42)).toBe("42");
  });

  it("non-integer numbers go through JSON.stringify", () => {
    expect(canonicalJson(3.14)).toBe("3.14");
  });

  it("non-finite number throws", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
  });

  it("strings are JSON-escaped", () => {
    expect(canonicalJson('he said "hi"')).toBe('"he said \\"hi\\""');
  });

  it("arrays preserve order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("nested arrays serialize recursively", () => {
    expect(canonicalJson([[1, 2], [3]])).toBe("[[1,2],[3]]");
  });

  it("objects sort keys lexicographically", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("nested objects sort at every depth", () => {
    expect(canonicalJson({ z: { y: 2, x: 1 }, a: [{ b: 2, a: 1 }] })).toBe(
      '{"a":[{"a":1,"b":2}],"z":{"x":1,"y":2}}',
    );
  });

  it("empty object becomes {}", () => {
    expect(canonicalJson({})).toBe("{}");
  });

  it("empty array becomes []", () => {
    expect(canonicalJson([])).toBe("[]");
  });
});

describe("sha256Hex / imageBytesSha256 — coverage", () => {
  it("sha256Hex of string equals SHA-256 of utf-8 bytes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("sha256Hex of Uint8Array yields the same digest", () => {
    expect(sha256Hex(Buffer.from("abc", "ascii"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("imageBytesSha256 alias matches sha256Hex", () => {
    expect(imageBytesSha256(Buffer.from("abc", "ascii"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
