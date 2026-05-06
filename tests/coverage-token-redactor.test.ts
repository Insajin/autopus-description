/**
 * Coverage gap — src/token-redactor.ts (redactJsonValue, wrapStream, countTokenMatches)
 */
import { describe, it, expect } from "vitest";
import {
  redact,
  redactJsonValue,
  wrapStream,
  countTokenMatches,
  TOKEN_PATTERN,
  REDACTED,
  type WritableLike,
} from "../src/token-redactor.js";

const TOKEN = "figd_TESTTOKEN1234567890";

describe("redact + redactJsonValue — coverage", () => {
  it("redacts a token in a string", () => {
    expect(redact(`auth=${TOKEN}`)).toBe(`auth=${REDACTED}`);
  });

  it("redactJsonValue passes through null and undefined unchanged", () => {
    expect(redactJsonValue(null)).toBeNull();
    expect(redactJsonValue(undefined)).toBeUndefined();
  });

  it("redactJsonValue redacts string leaves only", () => {
    expect(redactJsonValue(TOKEN)).toBe(REDACTED);
  });

  it("redactJsonValue passes through number and boolean unchanged", () => {
    expect(redactJsonValue(42)).toBe(42);
    expect(redactJsonValue(true)).toBe(true);
  });

  it("redactJsonValue recurses into arrays (including nested arrays)", () => {
    const out = redactJsonValue([TOKEN, ["nested", TOKEN], 7]);
    expect(out).toEqual([REDACTED, ["nested", REDACTED], 7]);
  });

  it("redactJsonValue recurses into objects with mixed types", () => {
    const out = redactJsonValue({ a: TOKEN, b: { c: TOKEN, d: 5, e: ["x", TOKEN] }, f: null });
    expect(out).toEqual({ a: REDACTED, b: { c: REDACTED, d: 5, e: ["x", REDACTED] }, f: null });
  });

  it("countTokenMatches returns 0 for clean string", () => {
    expect(countTokenMatches("hello world")).toBe(0);
  });

  it("countTokenMatches returns the global match count", () => {
    expect(countTokenMatches(`${TOKEN} ${TOKEN}_extra ${TOKEN}`)).toBeGreaterThanOrEqual(2);
  });

  it("TOKEN_PATTERN matches at least 16 trailing chars", () => {
    expect("figd_short".match(TOKEN_PATTERN)).toBeNull();
    expect(`figd_${"a".repeat(16)}`.match(TOKEN_PATTERN)).not.toBeNull();
  });
});

describe("wrapStream — coverage", () => {
  it("wraps a writable so string chunks pass through redact", () => {
    const captured: string[] = [];
    const original: WritableLike = {
      write: (chunk) => {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    };
    const wrapped = wrapStream(original);
    wrapped.write(`hello ${TOKEN} world`);
    expect(captured[0]).toBe(`hello ${REDACTED} world`);
  });

  it("wrapStream redacts Uint8Array chunks", () => {
    const captured: string[] = [];
    const original: WritableLike = {
      write: (chunk) => {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    };
    const wrapped = wrapStream(original);
    wrapped.write(Buffer.from(`hi ${TOKEN}`, "utf8"));
    expect(captured[0]).toBe(`hi ${REDACTED}`);
  });

  it("wrapStream forwards encoding and callback", () => {
    let receivedEncoding: BufferEncoding | undefined;
    let cbCalled = false;
    const original: WritableLike = {
      write: (_chunk, encoding, cb) => {
        receivedEncoding = encoding;
        cb?.();
        return true;
      },
    };
    const wrapped = wrapStream(original);
    wrapped.write("safe", "utf8", () => { cbCalled = true; });
    expect(receivedEncoding).toBe("utf8");
    expect(cbCalled).toBe(true);
  });
});
