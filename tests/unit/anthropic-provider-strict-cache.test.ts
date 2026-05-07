// SPEC-FIGMA-005 T20: anthropic-provider strict mode + cache_control + Files
// API option propagation. Split out from anthropic-provider.test.ts to keep
// that file under the 300-line cap.
//
// REQ-01, REQ-02, REQ-04, REQ-NFR-02. The mock SDK captures the
// messages.create payload so the test can assert exact field shapes.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { ErrorCode, ProviderError } from "../../src/types/llm-provider.js";
import {
  AnthropicClaudeAdapter,
  _strictParseJsonBody,
} from "../../src/providers/anthropic-provider.js";

const captured: { payloads: Array<Record<string, unknown>> } = { payloads: [] };

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class FakeAnthropic {
      messages = {
        create: vi.fn(async (req: Record<string, unknown>) => {
          captured.payloads.push(req);
          // Strict mode mock: SDK rejects when the response_format schema
          // carries the sentinel `__reject_strict: true` flag.
          const rf = (req as {
            response_format?: {
              json_schema?: { schema?: { __reject_strict?: boolean } };
            };
          }).response_format;
          if (rf?.json_schema?.schema?.__reject_strict) {
            const e = new Error(
              "Schema contains anyOf which is not supported in strict mode",
            ) as Error & { error?: unknown; status?: number };
            e.error = {
              type: "invalid_request_error",
              message:
                "Schema contains anyOf which is not supported in strict mode",
            };
            e.status = 400;
            throw e;
          }
          return {
            id: "req_test_001",
            content: [
              {
                type: "text",
                text: '{"intent":"x","user_value":"y","success_criteria":"z","intent_mismatch":false,"confidence":0.95,"states":[],"edge_cases":[],"data_io":[]}',
              },
            ],
            usage: {
              input_tokens: 800,
              output_tokens: 250,
              cache_read_input_tokens: 5000,
              cache_creation_input_tokens: 200,
            },
          };
        }),
      };
    },
  };
});

beforeEach(() => {
  captured.payloads = [];
});

describe("anthropic-provider strict + cache (T20)", () => {
  const baseOpts = {
    temperature: 0,
    model_id: "claude-sonnet-4-6",
    max_output_tokens: 2000,
  };

  it("REQ-01: cache_control_region wraps system prompt under cache_control: ephemeral", async () => {
    const adapter = new AnthropicClaudeAdapter({ apiKey: "test" });
    await adapter.generateNodeOnly("frame body", {
      ...baseOpts,
      cache_control_region: "SYSTEM PROMPT + SCHEMA + FENCE BOILERPLATE",
    });
    const payload = captured.payloads[0] as {
      system?: Array<Record<string, unknown>>;
    };
    expect(payload.system).toBeDefined();
    expect(payload.system?.[0]).toEqual({
      type: "text",
      text: "SYSTEM PROMPT + SCHEMA + FENCE BOILERPLATE",
      cache_control: { type: "ephemeral" },
    });
  });

  it("REQ-02: structured_output_schema produces response_format.json_schema.strict=true", async () => {
    const adapter = new AnthropicClaudeAdapter({ apiKey: "test" });
    await adapter.generateNodeOnly("frame body", {
      ...baseOpts,
      structured_output_schema: { type: "object" },
    });
    const payload = captured.payloads[0] as {
      response_format?: {
        type: string;
        json_schema?: { strict?: boolean; schema?: unknown };
      };
    };
    expect(payload.response_format?.type).toBe("json_schema");
    expect(payload.response_format?.json_schema?.strict).toBe(true);
    expect(payload.response_format?.json_schema?.schema).toEqual({
      type: "object",
    });
  });

  it("REQ-04: file_id reference produces image source: {type: 'file', file_id}", async () => {
    const adapter = new AnthropicClaudeAdapter({ apiKey: "test" });
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    await adapter.generateVision("frame body", image, {
      ...baseOpts,
      file_id: "file_xyz789",
    });
    const payload = captured.payloads[0] as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const imageBlock = payload.messages[0].content[0] as {
      type?: string;
      source?: { type?: string; file_id?: string };
    };
    expect(imageBlock.type).toBe("image");
    expect(imageBlock.source?.type).toBe("file");
    expect(imageBlock.source?.file_id).toBe("file_xyz789");
  });

  it("REQ-04 fallback: no file_id ⇒ base64 inline", async () => {
    const adapter = new AnthropicClaudeAdapter({ apiKey: "test" });
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await adapter.generateVision("frame body", image, baseOpts);
    const payload = captured.payloads[0] as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const imageBlock = payload.messages[0].content[0] as {
      source?: { type?: string };
    };
    expect(imageBlock.source?.type).toBe("base64");
  });

  it("REQ-NFR-02: strict mode rejection ⇒ SCHEMA_STRICT_INCOMPATIBLE", async () => {
    const adapter = new AnthropicClaudeAdapter({ apiKey: "test" });
    try {
      await adapter.generateNodeOnly("frame body", {
        ...baseOpts,
        // Sentinel inside the schema so it survives the adapter's
        // request body composition and reaches the SDK mock.
        structured_output_schema: {
          type: "object",
          __reject_strict: true,
        } as object,
      });
      throw new Error("expected ProviderError but call resolved");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(
        ErrorCode.SCHEMA_STRICT_INCOMPATIBLE,
      );
    }
  });

  it("LLMResponse.cache_read_input_tokens propagates from SDK usage", async () => {
    const adapter = new AnthropicClaudeAdapter({ apiKey: "test" });
    const resp = await adapter.generateNodeOnly("frame body", {
      ...baseOpts,
      cache_control_region: "static",
    });
    expect(resp.cache_read_input_tokens).toBe(5000);
    expect(resp.cache_creation_input_tokens).toBe(200);
    expect(resp.dynamic_input_tokens).toBe(800);
  });

  it("strictParseJsonBody throws PROVIDER_SDK_BREAKING_CHANGE on malformed JSON", () => {
    expect(() => _strictParseJsonBody("not json", "AUTH-01")).toThrow(
      /strict mode response failed JSON.parse/,
    );
    try {
      _strictParseJsonBody("not json", "AUTH-01");
    } catch (err) {
      expect((err as ProviderError).code).toBe(
        ErrorCode.PROVIDER_SDK_BREAKING_CHANGE,
      );
      expect((err as ProviderError).screen_id).toBe("AUTH-01");
    }
  });
});
