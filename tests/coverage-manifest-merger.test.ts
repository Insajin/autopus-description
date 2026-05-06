/**
 * Coverage gap — src/manifest-merger.ts (normalizeStub branches: array success_criteria,
 * empty/invalid placeholders, write_target validation, persona_tags fallback)
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeWithGenerationManifest } from "../src/manifest-merger.js";
import { DEFAULT_GENERATION_STUB } from "../src/manifest-writer.js";

async function writePartial(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "merger-cov-"));
  const partial = {
    schema_version: "0.1.0",
    pilot_metadata: { pm_reviewer_id: "pm", pilot_date: "2026-05-06", figma_file_ids: ["F"], total_token_cost: 0 },
    frames: [
      {
        screen_id: "FRAME-A",
        display_id: "FRAME-A",
        title: "A",
        navigation: [],
        source_hash: "0".repeat(64),
        design_tokens: null,
        variants: null,
        extraction_started_at: "2026-05-06T00:00:00Z",
        extraction_finished_at: "2026-05-06T00:00:01Z",
      },
    ],
    prototype: { entry: null, transitions: [] },
  };
  const p = join(dir, "partial.manifest.json");
  await writeFile(p, JSON.stringify(partial), "utf8");
  return p;
}

async function readMerged(path: string): Promise<{ frames: Array<Record<string, unknown>> }> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("mergeWithGenerationManifest — coverage", () => {
  it("uses defaults when generationPlaceholders is undefined", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({ partialPath });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].intent).toBe(DEFAULT_GENERATION_STUB.intent);
    expect(merged.frames[0].write_target).toBe(DEFAULT_GENERATION_STUB.write_target);
  });

  it("string success_criteria is preserved when non-empty", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { success_criteria: "tap completes in <2s" },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].success_criteria).toBe("tap completes in <2s");
  });

  it("array success_criteria is joined with '; '", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { success_criteria: ["A", "B", "C"] },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].success_criteria).toBe("A; B; C");
  });

  it("empty string success_criteria falls back to default", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { success_criteria: "" },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].success_criteria).toBe(DEFAULT_GENERATION_STUB.success_criteria);
  });

  it("empty array success_criteria falls back to default", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { success_criteria: [] },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].success_criteria).toBe(DEFAULT_GENERATION_STUB.success_criteria);
  });

  it("invalid write_target falls back to default", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { write_target: "not_valid_target" },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].write_target).toBe(DEFAULT_GENERATION_STUB.write_target);
  });

  it("valid write_target is honored", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { write_target: "frame_name" },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].write_target).toBe("frame_name");
  });

  it("empty intent and user_value fall back to defaults", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { intent: "", user_value: "" },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].intent).toBe(DEFAULT_GENERATION_STUB.intent);
    expect(merged.frames[0].user_value).toBe(DEFAULT_GENERATION_STUB.user_value);
  });

  it("non-string intent falls back to default", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { intent: undefined },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].intent).toBe(DEFAULT_GENERATION_STUB.intent);
  });

  it("preserves provided states / edge_cases / component_refs / data_io when non-empty", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: {
        states: ["loading", "loaded"],
        edge_cases: ["timeout"],
        component_refs: ["Btn"],
        data_io: ["GET /x"],
      },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].states).toEqual(["loading", "loaded"]);
    expect(merged.frames[0].edge_cases).toEqual(["timeout"]);
    expect(merged.frames[0].component_refs).toEqual(["Btn"]);
    expect(merged.frames[0].data_io).toEqual(["GET /x"]);
  });

  it("empty states / edge_cases / component_refs / data_io fall back to defaults", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { states: [], edge_cases: [], component_refs: [], data_io: [] },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].states).toEqual(DEFAULT_GENERATION_STUB.states);
    expect(merged.frames[0].edge_cases).toEqual(DEFAULT_GENERATION_STUB.edge_cases);
    expect(merged.frames[0].component_refs).toEqual(DEFAULT_GENERATION_STUB.component_refs);
    expect(merged.frames[0].data_io).toEqual(DEFAULT_GENERATION_STUB.data_io);
  });

  it("respects numeric confidence and boolean intent_mismatch", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { confidence: 0.42, intent_mismatch: true },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].confidence).toBe(0.42);
    expect(merged.frames[0].intent_mismatch).toBe(true);
  });

  it("non-array persona_tags falls back to default", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { persona_tags: [] },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].persona_tags).toEqual(DEFAULT_GENERATION_STUB.persona_tags);
  });

  it("preserves persona_tags when provided", async () => {
    const partialPath = await writePartial();
    const out = await mergeWithGenerationManifest({
      partialPath,
      generationPlaceholders: { persona_tags: ["pm", "designer"] },
    });
    const merged = await readMerged(out.path);
    expect(merged.frames[0].persona_tags).toEqual(["pm", "designer"]);
  });
});
