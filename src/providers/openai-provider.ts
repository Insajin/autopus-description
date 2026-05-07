// SPEC-FIGMA-003 sibling — OpenAI provider adapter via Responses API.
// Mirrors AnthropicClaudeAdapter's surface so it slots into the existing
// LLMProvider seam without touching routing/batch logic.

import OpenAI from "openai";

import {
  ErrorCode,
  ProviderError,
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../types/llm-provider.js";

interface OpenAIResponseLike {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// Pulls the assistant text from either the convenience accessor or the
// structured output array. Either may be present depending on SDK version
// or response shape, so we coalesce to a single string.
function extractText(resp: OpenAIResponseLike): string {
  if (typeof resp.output_text === "string" && resp.output_text.length > 0) {
    return resp.output_text;
  }
  const items = resp.output ?? [];
  const parts: string[] = [];
  for (const item of items) {
    for (const block of item.content ?? []) {
      if (block.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("");
}

// Prompts instruct the model to return strict JSON. Parse defensively so a
// malformed reply yields a low-confidence response instead of crashing.
function parseJsonBody(text: string): {
  confidence: number;
  intent_mismatch: boolean;
} {
  try {
    const parsed = JSON.parse(text.trim()) as {
      confidence?: unknown;
      intent_mismatch?: unknown;
    };
    return {
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0,
      intent_mismatch:
        typeof parsed.intent_mismatch === "boolean"
          ? parsed.intent_mismatch
          : false,
    };
  } catch {
    return { confidence: 0, intent_mismatch: false };
  }
}

export interface OpenAIAdapterOptions {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
}

export class OpenAIResponsesAdapter implements LLMProvider {
  private readonly client: OpenAI;

  constructor(opts: OpenAIAdapterOptions = {}) {
    this.client = new OpenAI({
      apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: opts.baseURL,
      organization: opts.organization,
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

  private async call(
    prompt: string,
    image: Buffer | undefined,
    opts: ProviderOpts,
  ): Promise<LLMResponse> {
    const content: Array<Record<string, unknown>> = [];
    if (image) {
      content.push({
        type: "input_image",
        image_url: `data:image/png;base64,${image.toString("base64")}`,
      });
    }
    content.push({ type: "input_text", text: prompt });
    let resp: OpenAIResponseLike;
    try {
      resp = (await this.client.responses.create({
        model: opts.model_id,
        max_output_tokens: opts.max_output_tokens,
        temperature: opts.temperature,
        input: [{ role: "user", content: content as never }],
      })) as OpenAIResponseLike;
    } catch (err) {
      throw mapSdkError(err);
    }
    const text = extractText(resp);
    const meta = parseJsonBody(text);
    return {
      text,
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
      confidence: meta.confidence,
      intent_mismatch: meta.intent_mismatch,
    };
  }
}

function mapSdkError(err: unknown): ProviderError {
  const e = err as { status?: number; message?: string };
  const msg = e?.message ?? "OpenAI SDK call failed";
  if (e?.status === 429) {
    return new ProviderError(ErrorCode.RATE_LIMIT_EXCEEDED, msg, undefined, {
      http_status: 429,
    });
  }
  return new ProviderError(ErrorCode.PROVIDER_ERROR, msg, undefined, {
    http_status: e?.status,
  });
}
