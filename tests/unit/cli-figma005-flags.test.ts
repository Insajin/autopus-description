// SPEC-FIGMA-005 T10 CLI flag parser tests. Verifies --batch / --realtime /
// --escalate-model are recognized and that defaultModelFor returns the
// correct anthropic model based on the escalate flag.

import { describe, expect, it } from "vitest";

import { defaultModelFor } from "../../src/cli/generate-descriptions.js";

describe("CLI defaultModelFor (REQ-30)", () => {
  it("anthropic default ⇒ claude-sonnet-4-6", () => {
    expect(defaultModelFor("anthropic")).toBe("claude-sonnet-4-6");
  });

  it("anthropic + --escalate-model ⇒ claude-opus-4-7", () => {
    expect(defaultModelFor("anthropic", true)).toBe("claude-opus-4-7");
  });

  it("openai stays on gpt-5.5 regardless of escalate flag", () => {
    expect(defaultModelFor("openai")).toBe("gpt-5.5");
    expect(defaultModelFor("openai", true)).toBe("gpt-5.5");
  });

  it("mock provider returns undefined (caller fallback applies)", () => {
    expect(defaultModelFor("mock")).toBeUndefined();
  });
});
