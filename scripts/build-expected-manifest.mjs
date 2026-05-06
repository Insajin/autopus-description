// SPEC-FIGMA-003: Generate the canonical expected-manifest.json for AC-S12
// determinism oracle. Idempotent — re-runs produce byte-identical output
// because the mock provider is SHA-256-seeded and we normalize timestamps.
//
// Run via: npx vite-node scripts/build-expected-manifest.mjs

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runBatch } from "../src/batch-executor.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const FIXTURE_DIR = join(ROOT, "tests/fixtures/mock-30frame");
const OUT_PATH = join(ROOT, "tests/fixtures/expected-manifest.json");

const frames = Array.from({ length: 30 }, (_, i) => ({
  screen_id: `F${String(i).padStart(2, "0")}`,
  source_hash: "abc123def456",
  frame_meta: { screen_id: `F${String(i).padStart(2, "0")}`, text_nodes: [] },
  screenshot_path: join(FIXTURE_DIR, `F${String(i).padStart(2, "0")}`, "screenshot.png"),
}));

const provider = new MockLLMProvider({
  responses: new Map(),
  useFixtureDir: FIXTURE_DIR,
});

const tmp = mkdtempSync(join(tmpdir(), "spec-figma-003-expect-"));
const out = join(tmp, "manifest.json");
await runBatch({
  frames,
  provider,
  output: out,
  temperature: 0,
  pilot_date: "1970-01-01",
});

const m = JSON.parse(readFileSync(out, "utf-8"));
m.pilot_metadata.run_timestamp = "2026-05-06T00:00:00.000Z";
m.frames.sort((a, b) => (a.screen_id < b.screen_id ? -1 : 1));
writeFileSync(OUT_PATH, JSON.stringify(m, null, 2) + "\n", "utf-8");

console.log(`expected-manifest written: ${OUT_PATH}`);
