/**
 * AC-S4 — rate-limit backoff timing
 *
 * Given a mock HTTP layer returning 429 on attempts 1 and 2, then 200 on attempt 3
 *   And the rate-limit helper is configured with sequence 3s, 6s, 12s and total budget 30s
 * When the read adapter requests a single frame's screenshot
 *   And start (t0), retry-1 (t1), retry-2 (t2), success (t3) timestamps are recorded
 * Then t1 - t0 >= 3000ms
 *  And t2 - t1 >= 6000ms
 *  And t3 - t0 <= 12000ms
 *  And recorded retry count == 2
 *  And no fourth retry is attempted (max attempts = 3 including initial)
 *
 * Linked: REQ-07, INV-006
 */
import { describe, it, expect } from "vitest";
import { withRateLimit, createMockHttp, RateLimitConfig } from "../src/rate-limit.js";

const CONFIG: RateLimitConfig = {
  backoffSchedule: [3000, 6000, 12000],
  totalBudgetMs: 30000,
  maxAttempts: 3,
};

describe("AC-S4: rate-limit backoff timing (3s, 6s, 12s budget)", () => {
  it("retry-1 elapses at least 3000ms after initial attempt", async () => {
    const mockHttp = createMockHttp({ responses: [429, 429, 200] });
    const timestamps: number[] = [];
    const onAttempt = (n: number) => timestamps.push(Date.now());

    await withRateLimit(CONFIG, () => mockHttp.get("/frame/1"), onAttempt);

    expect(timestamps.length).toBeGreaterThanOrEqual(3);
    const t0 = timestamps[0];
    const t1 = timestamps[1];
    expect(t1 - t0).toBeGreaterThanOrEqual(3000);
  }, 30000);

  it("retry-2 elapses at least 6000ms after retry-1", async () => {
    const mockHttp = createMockHttp({ responses: [429, 429, 200] });
    const timestamps: number[] = [];
    await withRateLimit(CONFIG, () => mockHttp.get("/frame/1"), (n) => timestamps.push(Date.now()));
    const t1 = timestamps[1];
    const t2 = timestamps[2];
    expect(t2 - t1).toBeGreaterThanOrEqual(6000);
  }, 30000);

  it("total elapsed time t3 - t0 is <= 12000ms (success on attempt 3)", async () => {
    const mockHttp = createMockHttp({ responses: [429, 429, 200] });
    const t0 = Date.now();
    await withRateLimit(CONFIG, () => mockHttp.get("/frame/1"));
    const t3 = Date.now();
    expect(t3 - t0).toBeLessThanOrEqual(12000);
  }, 30000);

  it("recorded retry count equals exactly 2", async () => {
    const mockHttp = createMockHttp({ responses: [429, 429, 200] });
    const result = await withRateLimit(CONFIG, () => mockHttp.get("/frame/1"));
    expect(result.retries).toBe(2);
  }, 30000);

  it("no fourth retry is attempted (max 3 attempts including initial)", async () => {
    const mockHttp = createMockHttp({ responses: [429, 429, 429, 429] });
    let attempts = 0;
    try {
      await withRateLimit(CONFIG, async () => {
        attempts += 1;
        return mockHttp.get("/frame/1");
      });
    } catch {
      // expected: retry_exhausted
    }
    expect(attempts).toBe(3);
  }, 30000);
});
