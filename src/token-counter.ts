// SPEC-FIGMA-003 T4: Provider-aware token counter and budget enforcement.
// Offline baseline: ceil(chars/4). Within ~20% of Anthropic tokenizer for
// EN/KO prose mixed with JSON. Swap behind same surface when Phase 0 says.
//
// SPEC-FIGMA-005 REQ-20, REQ-NFR-01: cached vs dynamic input token split.
// Cache budget enforcement counts (cached + dynamic) as the input cap input,
// so prompt evolution that invalidates the cache cannot silently exceed the
// 8K cap. splitInputTokens() reads the SDK usage object and returns the
// per-frame split for audit-emitter consumption.

import { ErrorCode, ProviderError } from "./types/llm-provider.js";

const DEFAULT_INPUT_LIMIT = 8000;
const DEFAULT_OUTPUT_LIMIT = 2000;

// Anthropic Vision: ~1500 tokens per 1024x1024 (SPEC §9). Cap matches worst case.
const PIXELS_PER_VISION_TOKEN = 750;
const VISION_TOKEN_CAP = 1500;
const DEFAULT_VISION_WIDTH = 1024;
const DEFAULT_VISION_HEIGHT = 1024;

export function countTokens(text: string, _model_id: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateImageTokens(
  width: number = DEFAULT_VISION_WIDTH,
  height: number = DEFAULT_VISION_HEIGHT,
): number {
  if (width <= 0 || height <= 0) return 0;
  const raw = Math.ceil((width * height) / PIXELS_PER_VISION_TOKEN);
  return Math.min(raw, VISION_TOKEN_CAP);
}

export function predictInputTokens(
  prompt: string,
  image_present: boolean,
  model_id: string,
): number {
  return (
    countTokens(prompt, model_id) + (image_present ? estimateImageTokens() : 0)
  );
}

// REQ-05 fail-fast. Throws before LLM call so no API spend on oversized input.
// SPEC-FIGMA-005 REQ-NFR-01: cached + dynamic counted as a single aggregate
// against the cap. Caller passes the SUM of cache_read + cache_creation +
// dynamic input tokens (or the predicted total when measuring pre-call).
export function enforceInputCap(
  measured: number,
  screen_id: string,
  limit: number = DEFAULT_INPUT_LIMIT,
): void {
  if (measured > limit) {
    throw new ProviderError(
      ErrorCode.TOKEN_BUDGET_EXCEEDED,
      `Input token budget exceeded for ${screen_id}: ${measured} > ${limit}`,
      screen_id,
      { measured_input_tokens: measured, limit },
    );
  }
}

// REQ-06 fail-fast. Mirrors enforceInputCap on the output side.
export function enforceOutputCap(
  measured: number,
  screen_id: string,
  limit: number = DEFAULT_OUTPUT_LIMIT,
): void {
  if (measured > limit) {
    throw new ProviderError(
      ErrorCode.OUTPUT_BUDGET_EXCEEDED,
      `Output token budget exceeded for ${screen_id}: ${measured} > ${limit}`,
      screen_id,
      { measured_output_tokens: measured, limit },
    );
  }
}

// SPEC-FIGMA-005 REQ-20: split SDK usage into cached vs dynamic measurements.
// AnthropicUsage shape (subset): { input_tokens, cache_read_input_tokens?,
// cache_creation_input_tokens? }. The plain input_tokens already excludes
// cached tokens per Anthropic 0.95 docs, so dynamic = input_tokens.
export interface AnthropicLikeUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface InputTokenSplit {
  cache_read: number;
  cache_creation: number;
  dynamic: number;
  total: number;
}

export function splitInputTokens(usage: AnthropicLikeUsage): InputTokenSplit {
  const cache_read = usage.cache_read_input_tokens ?? 0;
  const cache_creation = usage.cache_creation_input_tokens ?? 0;
  const dynamic = usage.input_tokens ?? 0;
  return {
    cache_read,
    cache_creation,
    dynamic,
    total: cache_read + cache_creation + dynamic,
  };
}

export const TOKEN_LIMITS = {
  INPUT: DEFAULT_INPUT_LIMIT,
  OUTPUT: DEFAULT_OUTPUT_LIMIT,
  VISION_CAP: VISION_TOKEN_CAP,
} as const;
