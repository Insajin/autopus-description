// SPEC-FIGMA-003 AC-S8 substitutability fixture replay adapter, extracted
// from anthropic-provider.ts to keep the main file under the 300-line cap
// (.claude/rules/autopus/file-size-limit.md).
//
// Replays previously-captured Anthropic responses from a fixture file. Used
// to prove the AnthropicClaudeAdapter's surface is interchangeable with the
// MockLLMProvider without making live API calls in CI.

import { existsSync, readFileSync } from "node:fs";

import {
  ErrorCode,
  ProviderError,
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../types/llm-provider.js";

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

export class RecordedAnthropicProvider implements LLMProvider {
  private readonly responses = new Map<
    string,
    RecordedFixture["frames"][0]["response"]
  >();

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
