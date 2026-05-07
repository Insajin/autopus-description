// SPEC-FIGMA-005 T5 / REQ-20 token-counter cached/dynamic split helper.
// REQ-NFR-01 cached + dynamic counted as single aggregate against the cap.

import { describe, expect, it } from "vitest";

import {
  enforceInputCap,
  splitInputTokens,
  TOKEN_LIMITS,
} from "../../src/token-counter.js";
import { ErrorCode, ProviderError } from "../../src/types/llm-provider.js";

describe("splitInputTokens (REQ-20)", () => {
  it("zero usage ⇒ all zeros", () => {
    const split = splitInputTokens({});
    expect(split).toEqual({
      cache_read: 0,
      cache_creation: 0,
      dynamic: 0,
      total: 0,
    });
  });

  it("typical cache hit usage shape", () => {
    const split = splitInputTokens({
      input_tokens: 800,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 200,
    });
    expect(split.cache_read).toBe(5000);
    expect(split.cache_creation).toBe(200);
    expect(split.dynamic).toBe(800);
    expect(split.total).toBe(6000);
  });

  it("cache miss usage (first frame)", () => {
    const split = splitInputTokens({
      input_tokens: 800,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5200,
    });
    expect(split.cache_read).toBe(0);
    expect(split.cache_creation).toBe(5200);
    expect(split.dynamic).toBe(800);
  });
});

describe("enforceInputCap aggregate semantics (REQ-NFR-01)", () => {
  it("PASS when cached + dynamic ≤ 8000", () => {
    expect(() => enforceInputCap(7999, "AUTH-01")).not.toThrow();
    expect(() => enforceInputCap(8000, "AUTH-01")).not.toThrow();
  });

  it("THROWS TOKEN_BUDGET_EXCEEDED when total > limit", () => {
    try {
      enforceInputCap(8001, "AUTH-01");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(ErrorCode.TOKEN_BUDGET_EXCEEDED);
      expect((err as ProviderError).screen_id).toBe("AUTH-01");
    }
  });

  it("TOKEN_LIMITS.INPUT remains 8000 (SPEC-FIGMA-003 boundary preserved)", () => {
    expect(TOKEN_LIMITS.INPUT).toBe(8000);
  });
});
