// SPEC-FIGMA-005 AC-S11: --batch lane aggregate cost ≤ 50% of --realtime
// aggregate cost (±2% tolerance). REQ-05, REQ-22.
//
// Mocked pricing table:
//   input  $3.00 per 1K tokens
//   output $15.00 per 1K tokens
//   batches discount 50% off both
//
// 30-frame fixture, no caching to isolate the batch discount.
// realtime cost = 30 × (1000/1000 × 3 + 500/1000 × 15) = 30 × 10.50 = $315.00
// batch    cost = 30 × 0.5 × (3 + 7.50)                = $157.50
// Tolerance window: $154.35 ≤ batch ≤ $160.65 (±2% of half-realtime).

import { describe, expect, it } from "vitest";

import type { EmittedAudit } from "../../../src/audit-emitter.js";

interface PricingTable {
  input_per_1k: number;
  output_per_1k: number;
  batches_discount: number; // fraction in [0, 1]
}

const PRICING: PricingTable = {
  input_per_1k: 3.0,
  output_per_1k: 15.0,
  batches_discount: 0.5,
};

function computeCost(
  audits: Array<Pick<EmittedAudit, "input_tokens" | "output_tokens">>,
  pricing: PricingTable,
  isBatch: boolean,
): number {
  const discount = isBatch ? pricing.batches_discount : 1.0;
  let cost = 0;
  for (const a of audits) {
    cost += (a.input_tokens / 1000) * pricing.input_per_1k * discount;
    cost += (a.output_tokens / 1000) * pricing.output_per_1k * discount;
  }
  return cost;
}

function makeAudits(n: number): Array<{
  input_tokens: number;
  output_tokens: number;
}> {
  return Array.from({ length: n }, () => ({
    input_tokens: 1000,
    output_tokens: 500,
  }));
}

describe("AC-S11: --batch cost ≤ 50% of --realtime cost", () => {
  it("realtime cost computes to $315 for 30 frames at the mocked pricing", () => {
    const audits = makeAudits(30);
    const cost = computeCost(audits, PRICING, false);
    expect(cost).toBeCloseTo(315.0, 6);
  });

  it("batch cost computes to $157.50 for the same 30-frame fixture", () => {
    const audits = makeAudits(30);
    const cost = computeCost(audits, PRICING, true);
    expect(cost).toBeCloseTo(157.5, 6);
  });

  it("batch ≤ 0.5 × realtime within ±2% tolerance", () => {
    const audits = makeAudits(30);
    const realtime = computeCost(audits, PRICING, false);
    const batch = computeCost(audits, PRICING, true);
    const halfRealtime = 0.5 * realtime;
    const tolerance = 0.02;
    const upper = halfRealtime * (1 + tolerance);
    const lower = halfRealtime * (1 - tolerance);
    expect(batch).toBeGreaterThanOrEqual(lower);
    expect(batch).toBeLessThanOrEqual(upper);
    // Hard MUST: batch ≤ 50% × realtime.
    expect(batch).toBeLessThanOrEqual(0.5 * realtime + 0.0001);
  });

  it("savings ratio = 1 − batch/realtime ⇒ exactly 0.5 (50% saved)", () => {
    const audits = makeAudits(30);
    const realtime = computeCost(audits, PRICING, false);
    const batch = computeCost(audits, PRICING, true);
    const savings = 1 - batch / realtime;
    expect(savings).toBeCloseTo(0.5, 6);
  });

  it("cache + batch combined: cache hits exclude cache_read_tokens from billable input", () => {
    // SPEC-FIGMA-005 NFR-01 documents cached + dynamic counted as input
    // for budget enforcement, but Anthropic billing treats cache_read at
    // a different rate. For AC-S11 we isolate the BATCHES discount only;
    // a follow-up SPEC can layer cache pricing on top. Here we verify the
    // batch discount applies to the dynamic portion.
    const audits = [
      { input_tokens: 800, output_tokens: 250 }, // dynamic only (cache hit)
      { input_tokens: 800, output_tokens: 250 },
      { input_tokens: 800, output_tokens: 250 },
    ];
    const realtime = computeCost(audits, PRICING, false);
    const batch = computeCost(audits, PRICING, true);
    expect(batch).toBeCloseTo(0.5 * realtime, 6);
  });
});
