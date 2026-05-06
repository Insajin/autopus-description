/**
 * AC-S9 — adapter substitutability (vendor-neutrality)
 *
 * Given AdapterA (use_figma reference impl) and AdapterB (mock test double)
 *   And both implement listTopLevelFrames, getFrameMeta, exportFrameImage, getPrototypeGraph
 * When the read pipeline runs once with each adapter against identical fixture inputs
 *   And volatile timestamp fields are stripped (as in AC-S6)
 * Then Object.keys(MA.frames[i]).sort() equals Object.keys(MB.frames[i]).sort() for i in [0..29]
 *  And field count per frame is identical between MA and MB
 *  And MA.frames[i].source_hash == MB.frames[i].source_hash for every i
 *  And both manifests pass tools/validate-manifest with exit code 0
 *
 * Linked: REQ-09, INV-003
 */
import { describe, it, expect } from "vitest";
import { runReadPipeline } from "../src/read-pipeline.js";
import { useFigmaAdapter } from "../src/adapters/use-figma-adapter.js";
import { mockAdapter } from "../src/adapters/mock-adapter.js";
import { stripVolatileTimestamps } from "../src/manifest-utils.js";
import { validateManifestExitCode } from "../src/validate-manifest.js";

describe("AC-S9: adapter substitutability between AdapterA (use_figma) and AdapterB (mock)", () => {
  const FIXTURE = "fixtures/30-frame-mock/";

  it("frame key sets are identical at every index 0..29 between MA and MB", async () => {
    const MA = stripVolatileTimestamps(await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE }));
    const MB = stripVolatileTimestamps(await runReadPipeline({ adapter: mockAdapter, fixturePath: FIXTURE }));
    expect(MA.frames.length).toBe(30);
    expect(MB.frames.length).toBe(30);
    for (let i = 0; i < 30; i++) {
      expect(Object.keys(MA.frames[i]).sort()).toEqual(Object.keys(MB.frames[i]).sort());
    }
  });

  it("field count per frame is identical", async () => {
    const MA = stripVolatileTimestamps(await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE }));
    const MB = stripVolatileTimestamps(await runReadPipeline({ adapter: mockAdapter, fixturePath: FIXTURE }));
    for (let i = 0; i < 30; i++) {
      expect(Object.keys(MA.frames[i]).length).toBe(Object.keys(MB.frames[i]).length);
    }
  });

  it("MA.frames[i].source_hash equals MB.frames[i].source_hash for every i", async () => {
    const MA = stripVolatileTimestamps(await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE }));
    const MB = stripVolatileTimestamps(await runReadPipeline({ adapter: mockAdapter, fixturePath: FIXTURE }));
    for (let i = 0; i < 30; i++) {
      expect(MA.frames[i].source_hash).toBe(MB.frames[i].source_hash);
    }
  });

  it("both manifests pass tools/validate-manifest (exit 0)", async () => {
    const MA = await runReadPipeline({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const MB = await runReadPipeline({ adapter: mockAdapter, fixturePath: FIXTURE });
    expect(await validateManifestExitCode(MA)).toBe(0);
    expect(await validateManifestExitCode(MB)).toBe(0);
  });
});
