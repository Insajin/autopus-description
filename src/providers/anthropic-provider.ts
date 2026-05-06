// SPEC-FIGMA-003 T2: Anthropic Claude provider adapter.
// Two classes ship from this file:
//   - AnthropicClaudeAdapter: live SDK call wrapper (production path)
//   - RecordedAnthropicProvider: replay-only adapter used by AC-S8 to verify
//     interface substitutability without touching the real API.

import { existsSync, readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

import {
  ErrorCode,
  ProviderError,
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../types/llm-provider.js";

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  content?: Array<AnthropicTextBlock | { type: string }>;
  usage?: AnthropicUsage;
}

function extractText(resp: AnthropicMessageResponse): string {
  const blocks = resp.content ?? [];
  return blocks
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// LLM is instructed to return strict JSON. Parse defensively — partial
// failure should yield a low-confidence response, not crash the batch.
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
    const conf =
      typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const im =
      typeof parsed.intent_mismatch === "boolean"
        ? parsed.intent_mismatch
        : false;
    return { confidence: conf, intent_mismatch: im };
  } catch {
    return { confidence: 0, intent_mismatch: false };
  }
}

export interface AnthropicAdapterOptions {
  apiKey?: string;
  // Override base URL (test harness, regional endpoint, proxy).
  baseURL?: string;
}

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

  private async call(
    prompt: string,
    image: Buffer | undefined,
    opts: ProviderOpts,
  ): Promise<LLMResponse> {
    const userBlocks: Array<Record<string, unknown>> = [];
    if (image) {
      userBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: image.toString("base64"),
        },
      });
    }
    userBlocks.push({ type: "text", text: prompt });
    let resp: AnthropicMessageResponse;
    try {
      resp = (await this.client.messages.create({
        model: opts.model_id,
        max_tokens: opts.max_output_tokens,
        temperature: opts.temperature,
        messages: [{ role: "user", content: userBlocks as never }],
      })) as AnthropicMessageResponse;
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
  const msg = e?.message ?? "Anthropic SDK call failed";
  if (e?.status === 429) {
    return new ProviderError(ErrorCode.RATE_LIMIT_EXCEEDED, msg, undefined, {
      http_status: 429,
    });
  }
  return new ProviderError(ErrorCode.PROVIDER_ERROR, msg, undefined, {
    http_status: e?.status,
  });
}

// ─── Replay adapter (used by AC-S8 substitutability test) ─────────────────

export interface RecordedAnthropicOptions {
  fixtureFile: string;
}

interface RecordedFixture {
  frames: Array<{
    screen_id: string;
    response: {
      text: string;
      input_tokens: number;
      output_tokens: number;
      confidence: number;
      intent_mismatch: boolean;
    };
  }>;
}

// Replays previously-captured Anthropic responses from a fixture file. Used
// to prove the AnthropicClaudeAdapter's surface is interchangeable with the
// MockLLMProvider without making live API calls in CI.
export class RecordedAnthropicProvider implements LLMProvider {
  private readonly responses = new Map<string, RecordedFixture["frames"][0]["response"]>();

  constructor(opts: RecordedAnthropicOptions) {
    if (!existsSync(opts.fixtureFile)) {
      throw new ProviderError(
        ErrorCode.PROVIDER_ERROR,
        `Recorded fixture not found: ${opts.fixtureFile}`,
      );
    }
    const data = JSON.parse(
      readFileSync(opts.fixtureFile, "utf-8"),
    ) as RecordedFixture;
    for (const f of data.frames ?? []) {
      this.responses.set(f.screen_id, f.response);
    }
  }

  async generateNodeOnly(
    prompt: string,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.replay(prompt);
  }

  async generateVision(
    prompt: string,
    _image: Buffer,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    return this.replay(prompt);
  }

  private replay(prompt: string): LLMResponse {
    const match = prompt.match(/"screen_id"\s*:\s*"([A-Z][A-Z0-9_-]{1,63})"/);
    const screen_id = match ? match[1] : undefined;
    const spec = screen_id ? this.responses.get(screen_id) : undefined;
    if (!spec) {
      throw new ProviderError(
        ErrorCode.PROVIDER_ERROR,
        `RecordedAnthropicProvider: no fixture for screen_id ${screen_id ?? "<unknown>"}`,
        screen_id,
      );
    }
    return { ...spec };
  }
}
