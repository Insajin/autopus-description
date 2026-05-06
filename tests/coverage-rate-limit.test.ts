/**
 * Coverage gap — src/rate-limit.ts (withBackoff, ConcurrencyLimiter, readConcurrency)
 *
 * Uses injected sleep/now to exercise backoff & limiter without real timers.
 */
import { describe, it, expect } from "vitest";
import {
  withBackoff,
  RetryableError,
  RetryExhaustedError,
  readConcurrency,
  ConcurrencyLimiter,
  DEFAULT_CONCURRENCY,
  withRateLimit,
  createMockHttp,
} from "../src/rate-limit.js";

describe("withBackoff — coverage", () => {
  it("succeeds on first attempt with retries=0", async () => {
    const result = await withBackoff(async () => "ok", { sleep: async () => {}, now: () => 0 });
    expect(result.value).toBe("ok");
    expect(result.retries).toBe(0);
  });

  it("retries on RetryableError then succeeds, sleeps with injected sleep", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    let t = 0;
    const result = await withBackoff(
      async () => {
        calls++;
        if (calls < 2) throw new RetryableError(429, "rate-limited");
        return "done";
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
          t += ms;
        },
        now: () => t,
      },
    );
    expect(result.value).toBe("done");
    expect(result.retries).toBe(1);
    expect(sleeps).toEqual([3000]);
  });

  it("non-retryable errors propagate immediately", async () => {
    await expect(
      withBackoff(
        async () => {
          throw new Error("boom");
        },
        { sleep: async () => {}, now: () => 0 },
      ),
    ).rejects.toThrow(/boom/);
  });

  it("exhausts retries and throws RetryExhaustedError with last status", async () => {
    let calls = 0;
    let t = 0;
    try {
      await withBackoff(
        async () => {
          calls++;
          throw new RetryableError(503, "five-oh-three");
        },
        {
          sleep: async (ms) => {
            t += ms;
          },
          now: () => t,
        },
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      expect((err as RetryExhaustedError).lastStatus).toBe(503);
    }
    expect(calls).toBe(3);
  });

  it("aborts before sleep when next wait would exceed budget", async () => {
    let t = 0;
    try {
      await withBackoff(
        async () => {
          throw new RetryableError(429, "throttled");
        },
        {
          sleep: async (ms) => {
            t += ms;
          },
          now: () => t,
          sequence: [3000, 6000, 12000],
          budgetMs: 2000,
        },
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
    }
  });

  it("custom sequence shorter than MAX_ATTEMPTS reuses last value", async () => {
    let calls = 0;
    let t = 0;
    const result = await withBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new RetryableError(429, "rl");
        return calls;
      },
      { sequence: [1, 2], sleep: async (ms) => { t += ms; }, now: () => t },
    );
    expect(result.value).toBe(3);
    expect(result.retries).toBe(2);
  });
});

describe("withRateLimit non-RetryableError path with status property", () => {
  it("treats {status:429} object as retryable", async () => {
    let calls = 0;
    const result = await withRateLimit(
      { backoffSchedule: [10, 10], totalBudgetMs: 30000, maxAttempts: 3 },
      async () => {
        calls++;
        if (calls < 2) {
          const err = Object.assign(new Error("rl"), { status: 429 });
          throw err;
        }
        return "ok";
      },
    );
    expect(result.value).toBe("ok");
    expect(result.retries).toBe(1);
  });

  it("treats {status:500} object as retryable", async () => {
    let calls = 0;
    const result = await withRateLimit(
      { backoffSchedule: [10, 10], totalBudgetMs: 30000, maxAttempts: 3 },
      async () => {
        calls++;
        if (calls < 2) {
          throw Object.assign(new Error("server"), { status: 502 });
        }
        return "ok";
      },
    );
    expect(result.value).toBe("ok");
  });

  it("non-retryable {status:400} object propagates", async () => {
    await expect(
      withRateLimit(
        { backoffSchedule: [1, 1], totalBudgetMs: 30000, maxAttempts: 3 },
        async () => {
          throw Object.assign(new Error("bad request"), { status: 400 });
        },
      ),
    ).rejects.toThrow(/bad request/);
  });

  it("aborts before sleep when next wait would exceed totalBudgetMs", async () => {
    await expect(
      withRateLimit(
        { backoffSchedule: [3000, 6000], totalBudgetMs: 100, maxAttempts: 3 },
        async () => {
          throw new RetryableError(429, "rl");
        },
      ),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
  });
});

describe("createMockHttp — coverage", () => {
  it("non-retryable 4xx (e.g. 404) throws plain Error", async () => {
    const http = createMockHttp({ responses: [404] });
    await expect(http.get("/x")).rejects.toThrow(/mock http 404/);
  });

  it("returns success object on 200", async () => {
    const http = createMockHttp({ responses: [200] });
    const out = await http.get("/x");
    expect(out.status).toBe(200);
    expect(out.path).toBe("/x");
  });

  it("repeats last response when index overflows", async () => {
    const http = createMockHttp({ responses: [200] });
    await http.get("/a");
    const second = await http.get("/b");
    expect(second.status).toBe(200);
  });
});

describe("readConcurrency — coverage", () => {
  it("returns DEFAULT_CONCURRENCY when env unset", () => {
    expect(readConcurrency({})).toBe(DEFAULT_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY when env value is non-numeric", () => {
    expect(readConcurrency({ FIGMA_READ_CONCURRENCY: "xyz" })).toBe(DEFAULT_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY when env value is < 1", () => {
    expect(readConcurrency({ FIGMA_READ_CONCURRENCY: "0" })).toBe(DEFAULT_CONCURRENCY);
  });

  it("parses positive integer", () => {
    expect(readConcurrency({ FIGMA_READ_CONCURRENCY: "5" })).toBe(5);
  });
});

describe("ConcurrencyLimiter — coverage", () => {
  it("runs serial tasks sequentially and tracks peakInFlight = 1", async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 2, minSpacingMs: 0, sleep: async () => {}, now: () => 0 });
    const r1 = await limiter.run(async () => "one");
    const r2 = await limiter.run(async () => "two");
    expect([r1, r2]).toEqual(["one", "two"]);
    expect(limiter.peakInFlight).toBe(1);
  });

  it("returns the inner-fn return value through run()", async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 2, minSpacingMs: 0, sleep: async () => {}, now: () => 0 });
    const out = await limiter.run(async () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
  });

  it("propagates rejection from the inner fn while still releasing the slot", async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1, minSpacingMs: 0, sleep: async () => {}, now: () => 0 });
    await expect(limiter.run(async () => { throw new Error("fail"); })).rejects.toThrow(/fail/);
    const after = await limiter.run(async () => "recovered");
    expect(after).toBe("recovered");
  });

  it("inserts spacing sleep when consecutive run starts are below minSpacingMs", async () => {
    const slept: number[] = [];
    let clock = 1000;
    const limiter = new ConcurrencyLimiter({
      concurrency: 1,
      minSpacingMs: 100,
      now: () => clock,
      sleep: async (ms) => { slept.push(ms); clock += ms; },
    });
    await limiter.run(async () => {});
    await limiter.run(async () => {});
    expect(slept.length).toBeGreaterThanOrEqual(1);
    expect(slept[0]).toBeGreaterThan(0);
  });

  it("queues a third task when cap=1 has 1 in-flight and resumes it after release", async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1, minSpacingMs: 0, sleep: async () => {}, now: () => 0 });
    const yieldMicro = () => new Promise((r) => setImmediate(r));
    let resolveHold: (() => void) | undefined;
    const hold = new Promise<void>((res) => { resolveHold = res; });
    let secondCompleted = false;
    const t1 = limiter.run(async () => { await hold; });
    await yieldMicro();
    const t2 = limiter.run(async () => { secondCompleted = true; return "second"; });
    await yieldMicro();
    expect(secondCompleted).toBe(false);
    resolveHold?.();
    await Promise.all([t1, t2]);
    expect(secondCompleted).toBe(true);
  });
});
