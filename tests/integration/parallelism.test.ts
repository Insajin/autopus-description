// SPEC-FIGMA-003 Phase 1.5 RED scaffold — parallelism + 429 backoff (S10, S20).
import { describe, it, expect } from "vitest";
import { runBatch } from "../../src/batch-executor.js";
import {
  MockLLMProvider,
  type MockResponseSpec,
} from "../../src/providers/mock-provider.js";
import { baseSpec, makeFrameInput, makeFrames, readManifest, tmpOut } from "./_helpers.js";

describe("SPEC-FIGMA-003 parallelism + retry — Must/Should AC oracle", () => {
  it("AC-S10: max in-flight provider calls <= parallelism (5) over 30 frames", async () => {
    const responses: Array<[string, MockResponseSpec]> = Array.from(
      { length: 30 },
      (_, i) => [`F${String(i).padStart(2, "0")}`, baseSpec({ confidence: 0.9 })],
    );
    const provider = new MockLLMProvider({
      responses: new Map(responses),
      // 50ms delay per call widens the concurrency window so the in-flight
      // counter peak is observable.
      delay_ms: 50,
    });
    const out = tmpOut();
    const result = await runBatch({
      frames: makeFrames(30),
      provider,
      output: out,
      parallelism: 5,
    });

    expect(result.exit_code).toBe(0);
    // The MockLLMProvider exposes the peak concurrent in-flight count via
    // its spy. The semaphore in runBatch must cap this at parallelism.
    expect(provider.spy.concurrent_in_flight_max).toBeLessThanOrEqual(5);
    expect(provider.spy.concurrent_in_flight_max).toBeGreaterThanOrEqual(2);
    expect(readManifest(out).frames.length).toBe(30);
  });

  it("AC-S20: 429 on first attempt → retry succeeds with >=1000ms gap", async () => {
    const provider = new MockLLMProvider({
      responses: new Map<string, MockResponseSpec>([
        [
          "RATE-01",
          baseSpec({ input_tokens: 800, output_tokens: 200, confidence: 0.85 }),
        ],
      ]),
      // Returns RATE_LIMIT_EXCEEDED on the 1st call for RATE-01, then 200 success on the 2nd.
      simulate_429_on: new Set(["RATE-01"]),
    });
    const out = tmpOut();
    const t0 = performance.now();
    await runBatch({
      frames: [makeFrameInput("RATE-01", "abc123def456")],
      provider,
      output: out,
      retry: { base_ms: 1000, factor: 2, max_attempts: 3 },
    });
    const elapsed = performance.now() - t0;

    // Only RATE-01 in the batch; total node-only call count == per-id count.
    expect(provider.spy.generateNodeOnly_count).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThanOrEqual(1500);
    const m = readManifest(out);
    expect(m.frames[0].screen_id).toBe("RATE-01");
  });
});
