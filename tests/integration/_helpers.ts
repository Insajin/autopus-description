/**
 * Shared helpers for SPEC-FIGMA-003 integration tests.
 * Keeps per-scenario test files within the file-size budget.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  MockLLMProvider,
  type MockResponseSpec,
} from "../../src/providers/mock-provider.js";

export const VALIDATE_TOOL = resolve(
  process.cwd(),
  "tools/validate-manifest/dist/index.js",
);
export const FIXTURE_30 = resolve(process.cwd(), "tests/fixtures/mock-30frame");
export const FIXTURE_5 = resolve(
  process.cwd(),
  "tests/fixtures/mock-30frame/subset-5.json",
);

export function tmpOut(name = "manifest.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "spec-figma-003-"));
  return join(dir, name);
}

export function runValidator(manifestPath: string) {
  return spawnSync(process.execPath, [VALIDATE_TOOL, manifestPath], {
    encoding: "utf-8",
  });
}

export function makeFrameInput(screen_id: string, source_hash: string) {
  return {
    screen_id,
    source_hash,
    frame_meta: { screen_id, name: screen_id, text_nodes: [] },
    screenshot_path: join(FIXTURE_30, screen_id, "screenshot.png"),
  };
}

export function parseStderrJsonLines(
  stderr: string,
): Array<Record<string, unknown>> {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function makeFrames(count: number, hash = "abc123def456") {
  return Array.from({ length: count }, (_, i) =>
    makeFrameInput(`F${String(i).padStart(2, "0")}`, hash),
  );
}

export function readManifest(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function mockOf(specs: Array<[string, MockResponseSpec]>) {
  return new MockLLMProvider({ responses: new Map(specs) });
}

export function baseSpec(
  overrides: Partial<MockResponseSpec> = {},
): MockResponseSpec {
  return {
    text: JSON.stringify({ intent: "테스트" }),
    input_tokens: 1000,
    output_tokens: 200,
    confidence: 0.9,
    intent_mismatch: false,
    ...overrides,
  };
}
