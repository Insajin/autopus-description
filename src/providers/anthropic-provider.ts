// SPEC-FIGMA-003 T2: Anthropic Claude provider adapter.
// SPEC-FIGMA-005 T2+T7: Prompt Caching (REQ-01), Structured Outputs strict
// (REQ-02), Files API file_id reference (REQ-04). Strict path bypasses the
// silent JSON repair fallback (REQ-NFR-02). file_id reference (vs base64
// inline) reuses the upload across calls with the same screenshot sha256.
//
// Companion files extracted to keep this under the 300-line cap:
//   - anthropic-replay.ts: RecordedAnthropicProvider (AC-S8 substitutability)
//   - anthropic-errors.ts: SDK error → ProviderError mapping helpers

import { readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

import {
  ErrorCode,
  ProviderError,
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../types/llm-provider.js";
import { mapSdkError, mapFilesError } from "./anthropic-errors.js";

export { RecordedAnthropicProvider } from "./anthropic-replay.js";
export type { RecordedAnthropicOptions } from "./anthropic-replay.js";

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  id?: string;
  content?: Array<AnthropicTextBlock | { type: string }>;
  usage?: AnthropicUsage;
}

interface AnthropicFileResponse {
  id: string;
}

function extractText(resp: AnthropicMessageResponse): string {
  const blocks = resp.content ?? [];
  return blocks
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Non-strict JSON parse with silent fallback. Retained ONLY for the
// non-strict path (when opts.structured_output_schema is not set) so
// MockLLMProvider replay paths and legacy tests continue to work.
function parseJsonBody(text: string): {
  confidence: number;
  intent_mismatch: boolean;
} {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as {
      confidence?: unknown;
      intent_mismatch?: unknown;
    };
    const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const im =
      typeof parsed.intent_mismatch === "boolean"
        ? parsed.intent_mismatch
        : false;
    return { confidence: conf, intent_mismatch: im };
  } catch {
    return { confidence: 0, intent_mismatch: false };
  }
}

// Strict path JSON parse (REQ-02, REQ-NFR-02). Strict mode contract: SDK
// returns valid JSON conforming to the json_schema. A throw here means SDK
// breaking change — surface as PROVIDER_SDK_BREAKING_CHANGE.
function strictParseJsonBody(
  text: string,
  screen_id?: string,
): { confidence: number; intent_mismatch: boolean } {
  const trimmed = text.trim();
  let parsed: { confidence?: unknown; intent_mismatch?: unknown };
  try {
    parsed = JSON.parse(trimmed) as {
      confidence?: unknown;
      intent_mismatch?: unknown;
    };
  } catch (err) {
    throw new ProviderError(
      ErrorCode.PROVIDER_SDK_BREAKING_CHANGE,
      `strict mode response failed JSON.parse: ${(err as Error).message}`,
      screen_id,
    );
  }
  const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const im =
    typeof parsed.intent_mismatch === "boolean"
      ? parsed.intent_mismatch
      : false;
  return { confidence: conf, intent_mismatch: im };
}

export interface AnthropicAdapterOptions {
  apiKey?: string;
  baseURL?: string;
}

function detectSdkVersion(): string {
  try {
    const url = new URL(
      "../../node_modules/@anthropic-ai/sdk/package.json",
      import.meta.url,
    );
    const raw = readFileSync(url, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const SDK_VERSION = detectSdkVersion();

export class AnthropicClaudeAdapter implements LLMProvider {
  private readonly client: Anthropic;

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: opts.baseURL,
    });
  }

  async generateNodeOnly(
    prompt: string,
    opts: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.call(prompt, undefined, opts);
  }

  async generateVision(
    prompt: string,
    image: Buffer,
    opts: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.call(prompt, image, opts);
  }

  /**
   * SPEC-FIGMA-005 REQ-04, REQ-21: upload screenshot bytes to the Anthropic
   * Files API and return the file_id. Caller (FileIdCache) caches by sha256.
   */
  async uploadScreenshot(image: Buffer): Promise<string> {
    try {
      const filesNs = this.client as unknown as {
        files?: { create?: (req: { file: Buffer }) => Promise<AnthropicFileResponse> };
        beta?: { files?: { upload?: (req: { file: Buffer }) => Promise<AnthropicFileResponse> } };
      };
      const target = filesNs.files ?? filesNs.beta?.files;
      const fn = filesNs.files?.create ?? filesNs.beta?.files?.upload;
      if (!fn || !target) {
        throw new ProviderError(
          ErrorCode.PROVIDER_SDK_BREAKING_CHANGE,
          "Anthropic SDK does not expose files.create or beta.files.upload",
        );
      }
      const resp = await fn.call(target, { file: image });
      return resp.id;
    } catch (err) {
      throw mapFilesError(err);
    }
  }

  private async call(
    prompt: string,
    image: Buffer | undefined,
    opts: ProviderOpts,
  ): Promise<LLMResponse> {
    const userBlocks: Array<Record<string, unknown>> = [];
    if (image) {
      // REQ-04: opts.file_id ⇒ file reference (image_input_tokens = 0).
      if (opts.file_id) {
        userBlocks.push({
          type: "image",
          source: { type: "file", file_id: opts.file_id },
        });
      } else {
        userBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: image.toString("base64"),
          },
        });
      }
    }
    userBlocks.push({ type: "text", text: prompt });

    // REQ-01: cache_control on the static prefix.
    const systemBlocks: Array<Record<string, unknown>> = [];
    if (opts.cache_control_region) {
      systemBlocks.push({
        type: "text",
        text: opts.cache_control_region,
        cache_control: { type: "ephemeral" },
      });
    }

    const requestBody: Record<string, unknown> = {
      model: opts.model_id,
      max_tokens: opts.max_output_tokens,
      temperature: opts.temperature,
      messages: [{ role: "user", content: userBlocks as never }],
    };
    if (systemBlocks.length > 0) {
      requestBody.system = systemBlocks;
    }
    // REQ-02: Structured Outputs strict mode opt-in.
    if (opts.structured_output_schema) {
      requestBody.response_format = {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: opts.structured_output_schema,
        },
      };
    }

    let resp: AnthropicMessageResponse;
    try {
      resp = (await this.client.messages.create(
        requestBody as never,
      )) as AnthropicMessageResponse;
    } catch (err) {
      throw mapSdkError(err, SDK_VERSION, opts);
    }
    const text = extractText(resp);
    const meta = opts.structured_output_schema
      ? strictParseJsonBody(text)
      : parseJsonBody(text);

    const usage = resp.usage ?? {};
    return {
      text,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      confidence: meta.confidence,
      intent_mismatch: meta.intent_mismatch,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      dynamic_input_tokens: usage.input_tokens ?? 0,
      file_id: opts.file_id,
      provider_sdk_version: SDK_VERSION,
      request_id: resp.id,
    };
  }
}

// Test-only exports for unit tests.
export function _getSdkVersion(): string {
  return SDK_VERSION;
}
export { strictParseJsonBody as _strictParseJsonBody };
