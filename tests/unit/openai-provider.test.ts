// Coverage for src/providers/openai-provider.ts.
// Mocks `openai` so the adapter exercises success, vision, error, and
// JSON-parse paths without making live API calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const ctorSpy = vi.fn();

// Class-based mock so vitest 4 honours the `new OpenAI(...)` constructor.
vi.mock("openai", () => {
  class MockOpenAI {
    responses = { create: createMock };
    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  }
  return { default: MockOpenAI };
});

import { OpenAIResponsesAdapter } from "../../src/providers/openai-provider.js";
import { ErrorCode, ProviderError } from "../../src/types/llm-provider.js";

const OPTS = { temperature: 0, model_id: "gpt-5.5", max_output_tokens: 1000 };

beforeEach(() => {
  createMock.mockReset();
  ctorSpy.mockReset();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("OpenAIResponsesAdapter — generateNodeOnly success", () => {
  it("parses output_text + usage + JSON body confidence/intent_mismatch", async () => {
    createMock.mockResolvedValueOnce({
      output_text: '{"confidence":0.91,"intent_mismatch":false}',
      usage: { input_tokens: 222, output_tokens: 88 },
    });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    const out = await adapter.generateNodeOnly("PROMPT", OPTS);
    expect(out.text).toBe('{"confidence":0.91,"intent_mismatch":false}');
    expect(out.input_tokens).toBe(222);
    expect(out.output_tokens).toBe(88);
    expect(out.confidence).toBe(0.91);
    expect(out.intent_mismatch).toBe(false);
    const call = createMock.mock.calls[0][0];
    expect(call.model).toBe("gpt-5.5");
    expect(call.max_output_tokens).toBe(1000);
    expect(call.temperature).toBe(0);
    // Node-only: only the input_text block, no input_image.
    expect(call.input[0].content).toHaveLength(1);
    expect(call.input[0].content[0]).toEqual({
      type: "input_text",
      text: "PROMPT",
    });
  });

  it("falls back to structured output[] when output_text absent", async () => {
    createMock.mockResolvedValueOnce({
      output: [
        {
          content: [
            { type: "output_text", text: '{"confidence":0.5,' },
            { type: "output_text", text: '"intent_mismatch":true}' },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    const out = await adapter.generateNodeOnly("P", OPTS);
    expect(out.text).toBe('{"confidence":0.5,"intent_mismatch":true}');
    expect(out.confidence).toBe(0.5);
    expect(out.intent_mismatch).toBe(true);
  });

  it("missing usage → input/output token counts default to 0", async () => {
    createMock.mockResolvedValueOnce({
      output_text: '{"confidence":0.7,"intent_mismatch":false}',
    });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    const out = await adapter.generateNodeOnly("P", OPTS);
    expect(out.input_tokens).toBe(0);
    expect(out.output_tokens).toBe(0);
  });

  it("malformed JSON → confidence=0, intent_mismatch=false (defensive)", async () => {
    createMock.mockResolvedValueOnce({ output_text: "not json{{" });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    const out = await adapter.generateNodeOnly("P", OPTS);
    expect(out.confidence).toBe(0);
    expect(out.intent_mismatch).toBe(false);
  });

  it("non-text output blocks are filtered out", async () => {
    createMock.mockResolvedValueOnce({
      output: [
        {
          content: [
            { type: "tool_call", text: "should be ignored" },
            { type: "output_text", text: "kept" },
          ],
        },
      ],
    });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    const out = await adapter.generateNodeOnly("P", OPTS);
    expect(out.text).toBe("kept");
  });
});

describe("OpenAIResponsesAdapter — generateVision", () => {
  it("includes a base64 input_image alongside the input_text block", async () => {
    createMock.mockResolvedValueOnce({
      output_text: '{"confidence":0.8,"intent_mismatch":false}',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const out = await adapter.generateVision("P", png, OPTS);
    expect(out.confidence).toBe(0.8);
    const call = createMock.mock.calls[0][0];
    expect(call.input[0].content).toHaveLength(2);
    expect(call.input[0].content[0]).toEqual({
      type: "input_image",
      image_url: `data:image/png;base64,${png.toString("base64")}`,
    });
    expect(call.input[0].content[1]).toEqual({
      type: "input_text",
      text: "P",
    });
  });
});

describe("OpenAIResponsesAdapter — error mapping", () => {
  it("HTTP 429 → ProviderError RATE_LIMIT_EXCEEDED with http_status=429", async () => {
    createMock.mockRejectedValueOnce({ status: 429, message: "rate limited" });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    await expect(adapter.generateNodeOnly("P", OPTS)).rejects.toMatchObject({
      name: "ProviderError",
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      metadata: { http_status: 429 },
    });
  });

  it("non-429 HTTP error → PROVIDER_ERROR carrying the original status", async () => {
    createMock.mockRejectedValueOnce({ status: 500, message: "internal" });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    try {
      await adapter.generateNodeOnly("P", OPTS);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(ErrorCode.PROVIDER_ERROR);
      expect((err as ProviderError).metadata).toEqual({ http_status: 500 });
    }
  });

  it("network-style error with no status falls back to default message", async () => {
    createMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    await expect(adapter.generateNodeOnly("P", OPTS)).rejects.toThrow(
      "ECONNRESET",
    );
  });

  it("vision call propagates SDK errors through the same mapper", async () => {
    createMock.mockRejectedValueOnce({ status: 429, message: "limit" });
    const adapter = new OpenAIResponsesAdapter({ apiKey: "k" });
    await expect(
      adapter.generateVision("P", Buffer.from([1]), OPTS),
    ).rejects.toMatchObject({ code: ErrorCode.RATE_LIMIT_EXCEEDED });
  });
});

describe("OpenAIResponsesAdapter — constructor option pass-through", () => {
  it("apiKey + baseURL + organization forward to the SDK client", () => {
    new OpenAIResponsesAdapter({
      apiKey: "k",
      baseURL: "https://example.test",
      organization: "org_123",
    });
    expect(ctorSpy).toHaveBeenCalledWith({
      apiKey: "k",
      baseURL: "https://example.test",
      organization: "org_123",
    });
  });

  it("falls back to OPENAI_API_KEY env when apiKey omitted", () => {
    process.env.OPENAI_API_KEY = "env_secret";
    new OpenAIResponsesAdapter();
    expect(ctorSpy.mock.calls[0][0]).toMatchObject({ apiKey: "env_secret" });
  });
});
