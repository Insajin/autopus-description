// SPEC-FIGMA-003 T10 helpers shared between batch-executor and
// batch-process-frame. Kept tiny so neither file pushes the 300-line cap.

import { ErrorCode, ProviderError } from "./types/llm-provider.js";

export interface ResolvedRetry {
  base_ms: number;
  factor: number;
  max_attempts: number;
}

export interface BatchError {
  screen_id: string;
  code: string;
  message: string;
  attempt_count: number;
}

export class StreamCapture {
  private readonly lines: string[] = [];
  push(line: object): void {
    this.lines.push(JSON.stringify(line));
  }
  text(): string {
    return this.lines.length === 0 ? "" : this.lines.join("\n") + "\n";
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retry: ResolvedRetry,
): Promise<{ value: T; attempts: number }> {
  let attempt = 1;
  let lastErr: unknown;
  while (attempt <= retry.max_attempts) {
    try {
      return { value: await fn(), attempts: attempt };
    } catch (err) {
      lastErr = err;
      const isRateLimit =
        err instanceof ProviderError &&
        err.code === ErrorCode.RATE_LIMIT_EXCEEDED;
      if (!isRateLimit || attempt === retry.max_attempts) break;
      const delay = retry.base_ms * Math.pow(retry.factor, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
  throw lastErr;
}

export function buildErrorLine(e: ProviderError, screen_id: string): object {
  if (
    e.code === ErrorCode.TOKEN_BUDGET_EXCEEDED ||
    e.code === ErrorCode.OUTPUT_BUDGET_EXCEEDED
  ) {
    return { code: e.code, screen_id, ...(e.metadata ?? {}) };
  }
  return { code: e.code, screen_id, message: e.message };
}

export async function semaphoreMap<I, O>(
  items: I[],
  parallelism: number,
  fn: (item: I, idx: number) => Promise<O>,
): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, parallelism) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
