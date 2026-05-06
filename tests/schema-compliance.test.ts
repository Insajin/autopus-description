/**
 * AC-S7 — schema compliance via tools/validate-manifest
 *
 * Given the read adapter produced partial.manifest.json against the 30-frame mock fixture
 *   And it is paired with a complementary generation.manifest.json containing valid placeholders
 *   And the merged manifest is written to merged.manifest.json
 * When tools/validate-manifest merged.manifest.json is run (FIGMA-001 산출물)
 * Then the process exits with code 0
 *  And stdout final summary line equals "RESULT pass=30 fail=0 total=30"
 *  And stderr is empty
 *  And merged manifest's schema_version equals the schema_version declared by SPEC-FIGMA-001
 *
 * Linked: REQ-06, REQ-NFR-02, INV-002
 */
import { describe, it, expect } from "vitest";
import { runReadPipelineToFiles } from "../src/read-pipeline.js";
import { useFigmaAdapter } from "../src/adapters/use-figma-adapter.js";
import { mergeWithGenerationManifest } from "../src/manifest-merger.js";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURE = "fixtures/30-frame-mock/";
const VALIDATE_TOOL = resolve(process.cwd(), "tools/validate-manifest/dist/index.js");

function runValidator(manifestPath: string) {
  return spawnSync(process.execPath, [VALIDATE_TOOL, manifestPath], {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
}

describe("AC-S7: schema compliance via tools/validate-manifest", () => {
  async function buildMerged(): Promise<string> {
    const result = await runReadPipelineToFiles({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const merged = await mergeWithGenerationManifest({
      partialPath: result.manifestPath,
      generationPlaceholders: {
        intent: "stub",
        user_value: "stub",
        success_criteria: ["stub"],
        states: ["default"],
        edge_cases: [],
        confidence: 0.9,
        intent_mismatch: false,
        write_target: "stub",
      },
    });
    return merged.path;
  }

  it("validate-manifest exits with code 0", async () => {
    const mergedPath = await buildMerged();
    const proc = runValidator(mergedPath);
    expect(proc.status).toBe(0);
  });

  it('stdout final summary line equals "RESULT pass=30 fail=0 total=30"', async () => {
    const mergedPath = await buildMerged();
    const proc = runValidator(mergedPath);
    const lines = proc.stdout.trim().split("\n");
    const last = lines[lines.length - 1];
    expect(last).toBe("RESULT pass=30 fail=0 total=30");
  });

  it("stderr is empty", async () => {
    const mergedPath = await buildMerged();
    const proc = runValidator(mergedPath);
    expect(proc.stderr).toBe("");
  });

  it("merged manifest schema_version equals SPEC-FIGMA-001 declared schema_version", async () => {
    const mergedPath = await buildMerged();
    const merged = JSON.parse(readFileSync(mergedPath, "utf8"));
    const figma001Schema = JSON.parse(readFileSync(resolve(process.cwd(), "schema/manifest.schema.json"), "utf8"));
    const expectedVersion = figma001Schema.properties?.schema_version?.const ?? figma001Schema.schema_version;
    expect(merged.schema_version).toBeDefined();
    expect(merged.schema_version).toBe(expectedVersion);
  });
});
