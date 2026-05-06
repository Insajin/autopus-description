// SPEC-FIGMA-003 T3: Deterministic mock LLM provider for CI/test.
// Determinism: SHA-256 of input prompt seeds the response selection so
// repeat runs produce byte-identical output (REQ-NFR-02 / AC-S12).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ErrorCode,
  ProviderError,
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "../types/llm-provider.js";

export interface MockResponseSpec {
  text: string;
  input_tokens: number;
  output_tokens: number;
  confidence: number;
  intent_mismatch: boolean;
}

export interface MockSpy {
  generateNodeOnly_count: number;
  generateVision_count: number;
  concurrent_in_flight_max: number;
}

export interface MockProviderOptions {
  responses: Map<string, MockResponseSpec>;
  // Override predicted input tokens — used by AC-S2 to trigger TOKEN_BUDGET_EXCEEDED
  // without supplying an actual oversized prompt.
  forceMeasuredInputTokens?: number;
  // Fixed delay per call (ms). Used by AC-S10 to expose concurrency races.
  delay_ms?: number;
  // Screen IDs that fail with HTTP 429 on the FIRST call only; subsequent
  // calls succeed. Used by AC-S20 to verify retry-with-backoff behavior.
  simulate_429_on?: Set<string>;
  // Throw PROVIDER_ERROR after this many calls. Used to test failure isolation.
  error_after?: number;
  // Lazy-loaded fixture file (one JSON file with `frames` array).
  useFixtureFile?: string;
  // Lazy-loaded fixture directory (one subdir per screen_id with response.json).
  useFixtureDir?: string;
}

interface FixtureFile {
  frames: Array<{
    screen_id: string;
    response: MockResponseSpec;
  }>;
}

function seedFromPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function extractScreenId(prompt: string): string | undefined {
  // The node-only prompt embeds {"screen_id":"<id>",...} in the structural
  // block. Recover it via a narrow regex; falls back to undefined when the
  // prompt was constructed differently (caller must then pass via opts).
  const match = prompt.match(/"screen_id"\s*:\s*"([A-Z][A-Z0-9_-]{1,63})"/);
  return match ? match[1] : undefined;
}

export class MockLLMProvider implements LLMProvider {
  private readonly responses: Map<string, MockResponseSpec>;
  private readonly opts: MockProviderOptions;
  private readonly first_call_429: Set<string>;
  private call_count = 0;
  private in_flight = 0;
  readonly spy: MockSpy = {
    generateNodeOnly_count: 0,
    generateVision_count: 0,
    concurrent_in_flight_max: 0,
  };

  constructor(opts: MockProviderOptions) {
    this.opts = opts;
    this.responses = new Map(opts.responses);
    this.first_call_429 = new Set(opts.simulate_429_on ?? []);
    if (opts.useFixtureFile) this.loadFixtureFile(opts.useFixtureFile);
    if (opts.useFixtureDir) this.loadFixtureDir(opts.useFixtureDir);
  }

  // Hook used by the routing engine for AC-S2: lets the provider override
  // the predicted input token count without ever being called for the LLM.
  measureInputTokens(_prompt: string, _image_present: boolean): number | null {
    return this.opts.forceMeasuredInputTokens ?? null;
  }

  async generateNodeOnly(
    prompt: string,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    this.spy.generateNodeOnly_count += 1;
    return this.invoke(prompt, false);
  }

  async generateVision(
    prompt: string,
    _image: Buffer,
    _opts: ProviderOpts,
  ): Promise<LLMResponse> {
    this.spy.generateVision_count += 1;
    return this.invoke(prompt, true);
  }

  private async invoke(prompt: string, _vision: boolean): Promise<LLMResponse> {
    this.call_count += 1;
    this.in_flight += 1;
    if (this.in_flight > this.spy.concurrent_in_flight_max) {
      this.spy.concurrent_in_flight_max = this.in_flight;
    }
    const screen_id = extractScreenId(prompt);
    try {
      if (
        this.opts.error_after !== undefined &&
        this.call_count > this.opts.error_after
      ) {
        throw new ProviderError(
          ErrorCode.PROVIDER_ERROR,
          `MockLLMProvider failure after call ${this.opts.error_after}`,
        );
      }
      // FIRST-call-only 429: consume the screen_id from the set so a retry
      // succeeds. Matches AC-S20 ("retry succeeds with >=1000ms gap").
      if (screen_id && this.first_call_429.has(screen_id)) {
        this.first_call_429.delete(screen_id);
        throw new ProviderError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          `MockLLMProvider simulated 429 for ${screen_id}`,
          screen_id,
          { http_status: 429 },
        );
      }
      if (this.opts.delay_ms && this.opts.delay_ms > 0) {
        await new Promise((r) => setTimeout(r, this.opts.delay_ms));
      }
      return this.lookupResponse(prompt, screen_id);
    } finally {
      this.in_flight -= 1;
    }
  }

  private lookupResponse(
    prompt: string,
    screen_id: string | undefined,
  ): LLMResponse {
    const spec = (screen_id && this.responses.get(screen_id)) || defaultSpec(prompt);
    return { ...spec };
  }

  private loadFixtureFile(path: string): void {
    if (!existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as FixtureFile;
      for (const f of data.frames ?? []) {
        if (f.screen_id && f.response) this.responses.set(f.screen_id, f.response);
      }
    } catch { /* malformed fixture surfaces downstream */ }
  }

  private loadFixtureDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry, "response.json");
      if (!existsSync(path)) continue;
      try {
        this.responses.set(entry, JSON.parse(readFileSync(path, "utf-8")) as MockResponseSpec);
      } catch { /* skip malformed entry */ }
    }
  }
}

function defaultSpec(prompt: string): MockResponseSpec {
  const seed = seedFromPrompt(prompt).slice(0, 6);
  return {
    text: JSON.stringify({
      intent: `mock-${seed}`,
      user_value: "mock user value",
      success_criteria: "mock criterion",
      intent_mismatch: false,
    }),
    input_tokens: 1000,
    output_tokens: 200,
    confidence: 0.85,
    intent_mismatch: false,
  };
}
