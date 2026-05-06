/**
 * AC-S6 — idempotency (2-run byte-equal after stripping volatile timestamps)
 *
 * Given the 30-frame mock fixture at fixtures/30-frame-mock/
 *   And the read adapter configured with FIGMA_READ_CONCURRENCY=2
 * When the adapter is invoked twice in succession against the same fixture
 *   producing manifest A and manifest B
 *   And volatile fields (frames[].extraction_started_at, frames[].extraction_finished_at,
 *   pilot_metadata.pilot_date) are stripped via JSON Pointer removal
 *   And both stripped manifests are serialized as canonical JSON into bufA / bufB
 * Then sha256(bufA) equals sha256(bufB) (zero tolerance)
 *  And bufA.length equals bufB.length
 *  And frames[].source_hash values are pairwise equal at every i in [0..29]
 *
 * Linked: REQ-NFR-01, INV-009
 */
import { describe, it, expect } from "vitest";
import { runReadPipeline } from "../src/read-pipeline.js";
import { useFigmaAdapter } from "../src/adapters/use-figma-adapter.js";
import { stripVolatileTimestamps, canonicalJson } from "../src/manifest-utils.js";
import { sha256Hex } from "../src/source-hash.js";

const FIXTURE = "fixtures/30-frame-mock/";

describe("AC-S6: idempotency across 2 runs", () => {
  it("sha256(bufA) equals sha256(bufB) (zero tolerance, exact byte equality)", async () => {
    process.env.FIGMA_READ_CONCURRENCY = "2";
    const A = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const B = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const bufA = Buffer.from(canonicalJson(stripVolatileTimestamps(A)), "utf8");
    const bufB = Buffer.from(canonicalJson(stripVolatileTimestamps(B)), "utf8");
    expect(sha256Hex(bufA)).toBe(sha256Hex(bufB));
  });

  it("bufA.length equals bufB.length", async () => {
    process.env.FIGMA_READ_CONCURRENCY = "2";
    const A = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const B = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const bufA = Buffer.from(canonicalJson(stripVolatileTimestamps(A)), "utf8");
    const bufB = Buffer.from(canonicalJson(stripVolatileTimestamps(B)), "utf8");
    expect(bufA.length).toBe(bufB.length);
  });

  it("frames[].source_hash values are pairwise equal at every index 0..29", async () => {
    process.env.FIGMA_READ_CONCURRENCY = "2";
    const A = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const B = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    expect(A.frames.length).toBe(30);
    expect(B.frames.length).toBe(30);
    for (let i = 0; i < 30; i++) {
      expect(A.frames[i].source_hash).toBe(B.frames[i].source_hash);
    }
  });
});
