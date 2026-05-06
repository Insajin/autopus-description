import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMergedManifest,
  DEFAULT_GENERATION_STUB,
  type GenerationStub,
  type PartialManifest,
} from "./manifest-writer.js";

/**
 * SPEC-FIGMA-002 AC-S7 helper: read a partial manifest from disk, fill in
 * SPEC-FIGMA-003 placeholders, and write the merged manifest to a temp path
 * suitable for `tools/validate-manifest`.
 */

export interface MergeOptions {
  readonly partialPath: string;
  readonly generationPlaceholders?: GenerationPlaceholders;
}

export interface GenerationPlaceholders {
  readonly intent?: string;
  readonly user_value?: string;
  readonly success_criteria?: string | ReadonlyArray<string>;
  readonly states?: ReadonlyArray<string>;
  readonly edge_cases?: ReadonlyArray<string>;
  readonly component_refs?: ReadonlyArray<string>;
  readonly data_io?: ReadonlyArray<string>;
  readonly confidence?: number;
  readonly intent_mismatch?: boolean;
  readonly write_target?: string;
  readonly persona_tags?: ReadonlyArray<"pm" | "designer" | "dev" | "qa">;
}

export interface MergeResult {
  readonly path: string;
}

export async function mergeWithGenerationManifest(opts: MergeOptions): Promise<MergeResult> {
  const partialRaw = await readFile(opts.partialPath, "utf8");
  const partial = JSON.parse(partialRaw) as PartialManifest;
  const stub: GenerationStub = normalizeStub(opts.generationPlaceholders);
  const merged = buildMergedManifest(partial, stub);
  const dir = await mkdtemp(join(tmpdir(), "merged-manifest-"));
  const path = join(dir, "merged.manifest.json");
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
  return { path };
}

const VALID_TARGETS: ReadonlyArray<GenerationStub["write_target"]> = [
  "annotation_card",
  "descriptions_page",
  "frame_name",
  "plugin_data",
  "none",
];

function normalizeStub(p: MergeOptions["generationPlaceholders"]): GenerationStub {
  const base = DEFAULT_GENERATION_STUB;
  if (!p) return base;
  const sc = p.success_criteria;
  let success_criteria: string;
  if (typeof sc === "string") success_criteria = sc.length > 0 ? sc : base.success_criteria;
  else if (Array.isArray(sc) && sc.length > 0) success_criteria = sc.join("; ");
  else success_criteria = base.success_criteria;
  let write_target: GenerationStub["write_target"] = base.write_target;
  if (typeof p.write_target === "string") {
    const candidate = p.write_target as GenerationStub["write_target"];
    if (VALID_TARGETS.includes(candidate)) write_target = candidate;
  }
  return {
    intent: typeof p.intent === "string" && p.intent.length > 0 ? p.intent : base.intent,
    user_value:
      typeof p.user_value === "string" && p.user_value.length > 0 ? p.user_value : base.user_value,
    success_criteria,
    states: p.states && p.states.length > 0 ? p.states : base.states,
    edge_cases: p.edge_cases && p.edge_cases.length > 0 ? p.edge_cases : base.edge_cases,
    component_refs: p.component_refs && p.component_refs.length > 0 ? p.component_refs : base.component_refs,
    data_io: p.data_io && p.data_io.length > 0 ? p.data_io : base.data_io,
    confidence: typeof p.confidence === "number" ? p.confidence : base.confidence,
    intent_mismatch: typeof p.intent_mismatch === "boolean" ? p.intent_mismatch : base.intent_mismatch,
    write_target,
    persona_tags: p.persona_tags && p.persona_tags.length > 0 ? p.persona_tags : base.persona_tags,
  };
}
