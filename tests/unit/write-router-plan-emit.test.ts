// SPEC-FIGMA-007 T1 — write-router `mode:"plan-emit"` parity tests.
// Acceptance: AC-S1, AC-S6 (plan-emit shape, target→op mapping, executor parity).
// REQ: 01, 09.

import { describe, it, expect, vi } from "vitest";
import {
  WriteRouter,
  ERROR_CODES,
  type ManifestEntry,
  type WriteTarget,
} from "../../packages/write-router/src/index.js";
import {
  PLUGIN_COMMAND_OPS,
  TARGET_TO_OP,
  type PlanEmitResult,
  type PluginCommand,
} from "../../packages/write-router/src/plan-emit/types.js";
import { computeManifestEntryHash } from "../../packages/write-router/src/idempotency.js";

const ALL_TARGETS: readonly WriteTarget[] = [
  "annotation_card",
  "descriptions_page",
  "comment",
  "plugin_data",
  "frame_name",
  "none",
] as const;

function makeEntry(target: WriteTarget = "annotation_card"): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "Login screen",
    intent: "primary CTA",
    user_value: "Designer ships description",
    success_criteria: "≤2s p95",
    states: ["default"],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abcd1234",
    write_target: target,
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe("WriteRouter.apply mode:'plan-emit' (REQ-01, AC-S1)", () => {
  it("returns PlanEmitResult shape with manifest_entry_hash + plugin_commands + undo_descriptor_template", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("annotation_card");
    const result = (await router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
    expect(Object.keys(result).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "plugin_commands",
        "undo_descriptor_template",
        "write_target",
      ].sort(),
    );
    expect(result.manifest_entry_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.plugin_commands.length).toBeGreaterThanOrEqual(1);
    expect(result.write_target).toBe("annotation_card");
    expect(result.frame_id).toBe(entry.frame_id);
  });

  it("manifest_entry_hash byte-equals computeManifestEntryHash(entry) — NFR-07 parity", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("descriptions_page");
    const result = (await router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
    expect(result.manifest_entry_hash).toBe(computeManifestEntryHash(entry));
  });

  it("does NOT invoke any adapter when mode is plan-emit (no Figma write)", async () => {
    const adapterApply = vi.fn();
    const adapterUndo = vi.fn();
    const router = new WriteRouter({
      adapters: {
        annotation_card: { apply: adapterApply, undo: adapterUndo },
      },
    });
    await router.apply(makeEntry("annotation_card"), { mode: "plan-emit" });
    expect(adapterApply).not.toHaveBeenCalled();
    expect(adapterUndo).not.toHaveBeenCalled();
  });

  it("does NOT mutate IdempotencyTracker — plan-emit is read-only on router state", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("none");
    await router.apply(entry, { mode: "plan-emit" });
    expect(router.getEntryStatus(entry)).toBe("pending");
  });

  it("each plugin_command has exactly the 2 keys {op, args} (AC-S1 set equality)", async () => {
    const router = new WriteRouter();
    for (const t of ALL_TARGETS) {
      const r = (await router.apply(makeEntry(t), { mode: "plan-emit" })) as PlanEmitResult;
      for (const cmd of r.plugin_commands) {
        expect(Object.keys(cmd).sort()).toEqual(["args", "op"]);
      }
    }
  });
});

describe("WriteTarget → PluginCommand op mapping (REQ-09, AC-S6)", () => {
  it.each(ALL_TARGETS)("%s maps to its declared op", async (target) => {
    const router = new WriteRouter();
    const result = (await router.apply(makeEntry(target), { mode: "plan-emit" })) as PlanEmitResult;
    const ops = result.plugin_commands.map((c) => c.op);
    expect(ops[0]).toBe(TARGET_TO_OP[target]);
    expect(PLUGIN_COMMAND_OPS).toContain(ops[0]);
  });

  it("annotation_card emits set_annotation with frameId and rendered text", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("annotation_card");
    const r = (await router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
    const cmd = r.plugin_commands[0] as Extract<PluginCommand, { op: "set_annotation" }>;
    expect(cmd.op).toBe("set_annotation");
    expect(cmd.args.frameId).toBe(entry.frame_id);
    expect(cmd.args.text).toContain(entry.title);
    expect(cmd.args.text).toContain(entry.intent);
  });

  it("comment resolves fileKey from PlanEmitContext.fileKey override", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("comment");
    const r = (await router.apply(entry, {
      mode: "plan-emit",
      planContext: { fileKey: "FILE_OVERRIDE" },
    })) as PlanEmitResult;
    const cmd = r.plugin_commands[0] as Extract<PluginCommand, { op: "post_comment" }>;
    expect(cmd.args.fileKey).toBe("FILE_OVERRIDE");
  });

  it("plugin_data uses description_${screen_id} key prefix (parity with executor adapter)", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("plugin_data");
    const r = (await router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
    const cmd = r.plugin_commands[0] as Extract<PluginCommand, { op: "set_plugin_data" }>;
    expect(cmd.args.key).toBe(`description_${entry.screen_id}`);
    expect(cmd.args.nodeId).toBe(entry.frame_id);
  });

  it("frame_name composes `${original} · ${screen_id}` from ctx.frameNodeName", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("frame_name");
    const r = (await router.apply(entry, {
      mode: "plan-emit",
      planContext: { frameNodeName: "Login" },
    })) as PlanEmitResult;
    const cmd = r.plugin_commands[0] as Extract<PluginCommand, { op: "set_frame_name" }>;
    expect(cmd.args.name).toBe(`Login · ${entry.screen_id}`);
    expect(cmd.args.originalName).toBe("Login");
  });

  it("none target emits exactly one noop command (preserves length>=1 invariant)", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("none");
    const r = (await router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
    expect(r.plugin_commands).toHaveLength(1);
    expect(r.plugin_commands[0]?.op).toBe("noop");
  });
});

describe("undo_descriptor_template per WriteTarget (REQ-08 hydration target)", () => {
  it("annotation_card → delete-node with empty node_id placeholder", async () => {
    const router = new WriteRouter();
    const r = (await router.apply(makeEntry("annotation_card"), { mode: "plan-emit" })) as PlanEmitResult;
    expect(r.undo_descriptor_template).toEqual({ type: "delete-node", node_id: "" });
  });

  it("comment → delete-comment with empty comment_id placeholder", async () => {
    const router = new WriteRouter();
    const r = (await router.apply(makeEntry("comment"), { mode: "plan-emit" })) as PlanEmitResult;
    expect(r.undo_descriptor_template).toEqual({ type: "delete-comment", comment_id: "" });
  });

  it("plugin_data → clear-plugin-data hydrated with frame_id + description_<screen_id> key", async () => {
    const router = new WriteRouter();
    const entry = makeEntry("plugin_data");
    const r = (await router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
    expect(r.undo_descriptor_template).toEqual({
      type: "clear-plugin-data",
      node_id: entry.frame_id,
      key: `description_${entry.screen_id}`,
    });
  });

  it("none → noop template", async () => {
    const router = new WriteRouter();
    const r = (await router.apply(makeEntry("none"), { mode: "plan-emit" })) as PlanEmitResult;
    expect(r.undo_descriptor_template).toEqual({ type: "noop" });
  });
});

describe("Executor mode preservation (NFR-04, REQ-16)", () => {
  it("apply(entry) without mode option preserves WriteResult contract (5-key shape)", async () => {
    const router = new WriteRouter();
    const result = await router.apply(makeEntry("none"));
    // executor mode `none` adapter completes successfully and returns WriteResult
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("write_id");
    expect(result).toHaveProperty("fallback_used");
    // plan-emit-specific keys MUST NOT be present in executor mode
    expect(result).not.toHaveProperty("plugin_commands");
    expect(result).not.toHaveProperty("manifest_entry_hash");
  });

  it("apply(entry, { mode:'executor' }) explicit mode behaves identically to default (idempotency hits on duplicate)", async () => {
    const router = new WriteRouter();
    const a = await router.apply(makeEntry("none"));
    expect(a).toHaveProperty("status");
    const err = await router.apply(makeEntry("none"), { mode: "executor" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code: string }).code).toBe(ERROR_CODES.IDEMPOTENT_SKIP);
  });
});
