import { describe, it, expect } from "vitest";
import {
  redactTokens,
  redactObject,
  redact,
} from "../../packages/write-router/src/redactor.js";

const FIGMA_TOKEN = "figd_TESTTOKEN1234567890ABCDEF";
const SLACK_TOKEN = "xoxb-TESTABCDE";

describe("redactTokens (REQ-13 / INV-007)", () => {
  it("replaces a Figma personal access token with <REDACTED>", () => {
    expect(redactTokens(`x ${FIGMA_TOKEN} y`)).toBe("x <REDACTED> y");
  });

  it("replaces a Slack bot token with <REDACTED>", () => {
    expect(redactTokens(`a ${SLACK_TOKEN} b`)).toBe("a <REDACTED> b");
  });

  it("replaces both tokens in one input string", () => {
    expect(redactTokens(`token ${FIGMA_TOKEN} and ${SLACK_TOKEN} plain`)).toBe(
      "token <REDACTED> and <REDACTED> plain",
    );
  });

  it("leaves strings without tokens untouched", () => {
    expect(redactTokens("nothing sensitive here")).toBe("nothing sensitive here");
  });

  it("exposes redact as alias of redactTokens", () => {
    expect(redact(`hi ${FIGMA_TOKEN}`)).toBe("hi <REDACTED>");
  });
});

describe("redactObject", () => {
  it("recurses through nested objects and preserves shape", () => {
    const input = {
      name: "alpha",
      cred: FIGMA_TOKEN,
      nested: { slack: SLACK_TOKEN, count: 3 },
      list: [FIGMA_TOKEN, "plain", { tok: SLACK_TOKEN }],
    };
    const out = redactObject(input) as typeof input;

    expect(out.name).toBe("alpha");
    expect(out.cred).toBe("<REDACTED>");
    expect(out.nested.slack).toBe("<REDACTED>");
    expect(out.nested.count).toBe(3);
    expect(out.list[0]).toBe("<REDACTED>");
    expect(out.list[1]).toBe("plain");
    expect((out.list[2] as { tok: string }).tok).toBe("<REDACTED>");
  });

  it("passes through non-string primitives unchanged", () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
    expect(redactObject(null)).toBe(null);
    expect(redactObject(undefined)).toBe(undefined);
  });
});
