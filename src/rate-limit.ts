/**
 * SPEC-FIGMA-002 REQ-07/REQ-20: backoff + concurrency.
 *
 * - Backoff sequence [3000, 6000, 12000] ms; max 3 attempts incl. initial; 30s budget.
 * - Retries on HTTP 429 / 5xx (caller raises RetryableError); other errors throw immediately.
 * - Concurrency limiter: cap=2 default, configurable via FIGMA_READ_CONCURRENCY.
 * - Min spacing 1s between consecutive request starts.
 */

// @AX:NOTE:[AUTO] — REQ-07 backoff sequence locked; AC-S4 oracle (t1−t0 ≥ 3000ms, t2−t1 ≥ 6000ms, t3−t0 ≤ 12000ms)
export const BACKOFF_MS: readonly number[] = [3000, 6000, 12000];
// @AX:NOTE:[AUTO] — REQ-07 max 3 attempts incl. initial; on exhaustion the caller emits audit status="retry_exhausted" (REQ-22)
export const MAX_ATTEMPTS = 3;
// @AX:NOTE:[AUTO] — REQ-07 30s per-frame total wait cap; protects 5min p95 batch wall-clock (REQ-NFR-04)
export const BUDGET_MS = 30_000;
// @AX:NOTE:[AUTO] — REQ-20 min spacing between consecutive request starts; respects Figma 60 req/min publicly documented limit
export const MIN_SPACING_MS = 1000;
// @AX:NOTE:[AUTO] — REQ-20 default concurrency; FIGMA_READ_CONCURRENCY env var overrides (AC-S22)
export const DEFAULT_CONCURRENCY = 2;

export class RetryableError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "RetryableError";
  }
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastStatus: number;
  constructor(attempts: number, lastStatus: number) {
    super(`retry_exhausted after ${attempts} attempts (last status ${lastStatus})`);
    this.attempts = attempts;
    this.lastStatus = lastStatus;
    this.name = "RetryExhaustedError";
  }
}

export interface BackoffOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly sequence?: readonly number[];
  readonly budgetMs?: number;
  readonly maxAttempts?: number;
  readonly onAttempt?: (attemptIndex: number) => void;
  /**
   * When true, plain `{status: 429|5xx}` rejections are treated as retryable in
   * addition to `RetryableError`. Default false — only RetryableError is caught.
   * `withRateLimit` enables this for the AC-S4 mock-http surface where errors
   * carry a numeric status field rather than the typed RetryableError class.
   */
  readonly acceptStatusObject?: boolean;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BackoffResult<T> {
  readonly value: T;
  readonly retries: number;
}

function retryableStatusFrom(err: unknown, acceptStatusObject: boolean): number | null {
  if (err instanceof RetryableError) return err.status;
  if (acceptStatusObject && typeof err === "object" && err !== null && "status" in (err as object)) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number" && (s === 429 || (s >= 500 && s < 600))) return s;
  }
  return null;
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<BackoffResult<T>> {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const seq = opts.sequence ?? BACKOFF_MS;
  const budget = opts.budgetMs ?? BUDGET_MS;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const acceptStatusObject = opts.acceptStatusObject ?? false;
  const t0 = now();
  let lastStatus = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const wait = seq[attempt - 1] ?? seq[seq.length - 1];
      if (now() - t0 + wait > budget) {
        throw new RetryExhaustedError(attempt, lastStatus);
      }
      await sleep(wait);
    }
    if (opts.onAttempt) opts.onAttempt(attempt);
    try {
      const value = await fn();
      return { value, retries: attempt };
    } catch (err) {
      const status = retryableStatusFrom(err, acceptStatusObject);
      if (status !== null) {
        lastStatus = status;
        continue;
      }
      throw err;
    }
  }
  throw new RetryExhaustedError(maxAttempts, lastStatus);
}

export function readConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FIGMA_READ_CONCURRENCY;
  if (!raw) return DEFAULT_CONCURRENCY;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return n;
}

export interface LimiterOptions {
  readonly concurrency?: number;
  readonly minSpacingMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RateLimitConfig {
  readonly backoffSchedule: readonly number[];
  readonly totalBudgetMs: number;
  readonly maxAttempts: number;
}

export interface RateLimitResult<T> {
  readonly value: T;
  readonly retries: number;
}

/**
 * Test-facing helper that drives the same backoff sequence as withBackoff but
 * notifies the caller at the start of each attempt (so AC-S4 can record
 * t0/t1/t2/t3) and accepts plain `{status: 429|5xx}` rejections in addition to
 * RetryableError. Internally delegates to withBackoff to keep the control flow
 * single-source — preserves AC-S4 real-wall-clock timing (3s/6s/12s) by
 * defaulting to `realSleep` and not injecting a fake clock.
 */
export async function withRateLimit<T>(
  config: RateLimitConfig,
  fn: () => Promise<T>,
  onAttempt?: (attemptIndex: number) => void,
): Promise<RateLimitResult<T>> {
  return withBackoff(fn, {
    sequence: config.backoffSchedule,
    budgetMs: config.totalBudgetMs,
    maxAttempts: config.maxAttempts,
    onAttempt,
    acceptStatusObject: true,
  });
}

export interface MockHttpOptions {
  readonly responses: readonly number[];
}

export interface MockHttp {
  get(path: string): Promise<{ status: number; path: string }>;
}

export function createMockHttp(opts: MockHttpOptions): MockHttp {
  let i = 0;
  return {
    async get(path: string) {
      const status = opts.responses[i] ?? opts.responses[opts.responses.length - 1];
      i++;
      if (status === 429 || (status >= 500 && status < 600)) {
        throw new RetryableError(status, `mock http ${status}`);
      }
      if (status >= 400) throw new Error(`mock http ${status}`);
      return { status, path };
    },
  };
}

export class ConcurrencyLimiter {
  private readonly cap: number;
  private readonly spacing: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private inFlight = 0;
  private lastStart = 0;
  private peak = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(opts: LimiterOptions = {}) {
    this.cap = opts.concurrency ?? readConcurrency();
    this.spacing = opts.minSpacingMs ?? MIN_SPACING_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
  }

  get peakInFlight(): number {
    return this.peak;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    const since = this.now() - this.lastStart;
    if (this.lastStart > 0 && since < this.spacing) {
      await this.sleep(this.spacing - since);
    }
    this.lastStart = this.now();
    this.inFlight++;
    if (this.inFlight > this.peak) this.peak = this.inFlight;
    try {
      return await fn();
    } finally {
      this.inFlight--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.cap) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}
