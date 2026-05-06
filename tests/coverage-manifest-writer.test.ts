/**
 * Coverage gap — src/manifest-writer.ts (stripVolatile, buildMergedManifest defaults
 * for null design_tokens/variants, serializePartial token redaction)
 */
import { describe, it, expect } from "vitest";
import {
  serializePartial,
  stripVolatile,
  buildMergedManifest,
  DEFAULT_GENERATION_STUB,
  SCHEMA_VERSION,
  type PartialManifest,
} from "../src/manifest-writer.js";

const partial: PartialManifest = {
  schema_version: SCHEMA_VERSION,
  pilot_metadata: { pm_reviewer_id: "pm", pilot_date: "2026-05-06", figma_file_ids: ["F"], total_token_cost: 0 },
  frames: [
    {
      screen_id: "FRAME-A",
      display_id: "FRAME-A",
      title: "A token=figd_TESTTOKEN1234567890",
      navigation: ["FRAME-B"],
      source_hash: "0".repeat(64),
      design_tokens: null,
      variants: null,
      extraction_started_at: "2026-05-06T00:00:00Z",
      extraction_finished_at: "2026-05-06T00:00:01Z",
    },
    {
      screen_id: "FRAME-B",
      display_id: "FRAME-B",
      title: "B",
      navigation: [],
      source_hash: "1".repeat(64),
      design_tokens: ["color/x"],
      variants: ["state=default"],
      extraction_started_at: "2026-05-06T00:00:02Z",
      extraction_finished_at: "2026-05-06T00:00:03Z",
    },
  ],
  prototype: { entry: "FRAME-A", transitions: [{ from: "FRAME-A", to: "FRAME-B", trigger: "ON_CLICK" }] },
};

describe("manifest-writer — coverage", () => {
  it("serializePartial emits canonical sorted keys", () => {
    const text = serializePartial(partial);
    const reparsed = JSON.parse(text);
    expect(Object.keys(reparsed).sort()).toEqual(["frames", "pilot_metadata", "prototype", "schema_version"]);
  });

  it("serializePartial redacts tokens embedded in title field", () => {
    const text = serializePartial(partial);
    expect(text).not.toContain("figd_TESTTOKEN1234567890");
    expect(text).toContain("***");
  });

  it("stripVolatile removes pilot_date and extraction_*at fields", () => {
    const out = stripVolatile(partial) as { pilot_metadata: Record<string, unknown>; frames: Array<Record<string, unknown>> };
    expect(out.pilot_metadata).not.toHaveProperty("pilot_date");
    for (const f of out.frames) {
      expect(f).not.toHaveProperty("extraction_started_at");
      expect(f).not.toHaveProperty("extraction_finished_at");
    }
    expect(out.pilot_metadata.pm_reviewer_id).toBe("pm");
  });

  it("stripVolatile preserves prototype and schema_version", () => {
    const out = stripVolatile(partial) as { prototype: unknown; schema_version: string };
    expect(out.schema_version).toBe(SCHEMA_VERSION);
    expect(out.prototype).toEqual(partial.prototype);
  });

  it("buildMergedManifest uses [] for null design_tokens and variants", () => {
    const merged = buildMergedManifest(partial, DEFAULT_GENERATION_STUB) as {
      frames: Array<{ design_tokens: unknown[]; variants: unknown[] }>;
    };
    expect(merged.frames[0].design_tokens).toEqual([]);
    expect(merged.frames[0].variants).toEqual([]);
    expect(merged.frames[1].design_tokens).toEqual(["color/x"]);
    expect(merged.frames[1].variants).toEqual(["state=default"]);
  });

  it("buildMergedManifest copies stub fields onto every frame", () => {
    const merged = buildMergedManifest(partial, DEFAULT_GENERATION_STUB) as {
      frames: Array<{ intent: string; write_target: string; token_usage: { input_tokens: number; output_tokens: number } }>;
    };
    expect(merged.frames[0].intent).toBe(DEFAULT_GENERATION_STUB.intent);
    expect(merged.frames[1].write_target).toBe(DEFAULT_GENERATION_STUB.write_target);
    expect(merged.frames[0].token_usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
