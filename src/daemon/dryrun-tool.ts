// SPEC-FIGMA-007 REQ-02 — daemon-side dryRunWrite tool.
// Builds a ManifestEntry stub for the requested frame_id (mock-driven for
// Phase 0 dogfood; real flow consumes the latest runBatch result), invokes
// `WriteRouter.apply(entry, { mode: "plan-emit" })`, persists a PendingWrite
// record in the store, and returns the AC-S1 7-key oracle shape.

import { computeSourceHash, type CanonicalValue } from "../source-hash.js";
import { WriteRouter } from "../../packages/write-router/src/index.js";
import type {
  ManifestEntry,
  WriteTarget,
} from "../../packages/write-router/src/types.js";
import type { PlanEmitResult } from "../../packages/write-router/src/plan-emit/types.js";
import type {
  PendingWriteStore,
  PendingWriteSerializable,
} from "./pending-writes.js";

export interface DryRunWriteArgs {
  frame_id: string;
  write_target: WriteTarget;
  // Optional caller-supplied entry override; production daemon will derive
  // this from `runBatch` results, but tests/mocks pass deterministic values.
  entry_override?: Partial<ManifestEntry>;
  source_hash_override?: string;
}

export interface DryRunDeps {
  store: PendingWriteStore;
  router: WriteRouter;
  // Mocked source-hash inputs for Phase 0 dogfood; real daemon wires this to
  // the live figma node read pipeline.
  resolveSourceHash?: (frame_id: string) => string;
}

const DEFAULT_NODE_TREE: CanonicalValue = { a: 1, b: 2 } as CanonicalValue;
const DEFAULT_IMAGE_BYTES = Buffer.from("abc", "ascii");

function defaultSourceHash(): string {
  return computeSourceHash({
    node_tree_summary: DEFAULT_NODE_TREE,
    image_bytes: DEFAULT_IMAGE_BYTES,
  });
}

function buildStubEntry(
  frame_id: string,
  write_target: WriteTarget,
  source_hash: string,
  override: Partial<ManifestEntry> = {},
): ManifestEntry {
  const screen_id = override.screen_id ?? `FRAME-${frame_id.replace(":", "-")}`;
  const base: ManifestEntry = {
    screen_id,
    frame_id,
    title: override.title ?? "Login screen",
    intent: override.intent ?? "primary CTA",
    user_value: override.user_value ?? "Designer ships description",
    success_criteria: override.success_criteria ?? "p95 ≤ 2s",
    states: override.states ?? ["default"],
    edge_cases: override.edge_cases ?? [],
    component_refs: override.component_refs ?? [],
    data_io: override.data_io ?? [],
    design_tokens: override.design_tokens ?? [],
    variants: override.variants ?? [],
    navigation: override.navigation ?? [],
    confidence: override.confidence ?? 0.9,
    intent_mismatch: override.intent_mismatch ?? false,
    source_hash,
    write_target,
    persona_tags: override.persona_tags ?? ["pm"],
    token_usage: override.token_usage ?? { input_tokens: 0, output_tokens: 0 },
  };
  return base;
}

export async function dryRunWrite(
  deps: DryRunDeps,
  args: DryRunWriteArgs,
): Promise<PendingWriteSerializable> {
  const source_hash =
    args.source_hash_override ??
    (deps.resolveSourceHash
      ? deps.resolveSourceHash(args.frame_id)
      : defaultSourceHash());
  const entry = buildStubEntry(
    args.frame_id,
    args.write_target,
    source_hash,
    args.entry_override,
  );
  const plan = (await deps.router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
  const record = deps.store.put({
    manifest_entry_hash: plan.manifest_entry_hash,
    source_hash_dryrun: source_hash,
    plugin_commands: [...plan.plugin_commands],
    frame_id: args.frame_id,
    write_target: args.write_target,
    undo_template: plan.undo_descriptor_template,
  });
  return deps.store.toSerializable(record);
}
