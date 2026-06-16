// SPEC-FIGMA-020 T14 — composite plan-emit oracle (S6, S8, REQ-02, REQ-13).
//
// `planNativeAnnotationWithCard` emits the native op(s) FIRST (authoritative)
// then exactly ONE `set_policy_card` op (INV-01: native precedes card). The card
// op literal is lexically distinct from `set_annotation` and
// `set_native_annotation`. TARGET_TO_OP maps the composite to its primary native
// op and the card op is a first-class PLUGIN_COMMAND_OPS member.
//
// NOTE (T13): a byte-unchanged guard assertion on planAnnotationCard will be
// ADDED to this file afterward — the S8 block below is the well-structured home
// for it.

import { describe, it, expect } from "vitest";
import { planNativeAnnotationWithCard } from "../src/plan-emit/native-annotation-with-card-plan.js";
import { planAnnotationCard } from "../src/plan-emit/annotation-card-plan.js";
import {
  TARGET_TO_OP,
  PLUGIN_COMMAND_OPS,
} from "../src/plan-emit/types.js";
import type { ManifestEntry } from "../src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "10:0",
    title: "검색 화면",
    intent: "사용자 인증 게이트",
    user_value: "PM 진입",
    success_criteria: "5초",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "abc12345",
    write_target: "native_annotation_with_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

describe("plan-emit composite — native first, exactly one card op (S6, INV-01)", () => {
  it("emits exactly one set_native_annotation op then exactly one set_policy_card op", () => {
    // No area_annotations → exactly one frame-level native op.
    const commands = planNativeAnnotationWithCard(makeEntry(), {});
    const ops = commands.map((c) => c.op);
    expect(ops).toEqual(["set_native_annotation", "set_policy_card"]);
  });

  it("begins with a set_native_annotation op and ends with exactly one set_policy_card op", () => {
    const commands = planNativeAnnotationWithCard(makeEntry(), {});
    expect(commands[0].op).toBe("set_native_annotation");
    expect(commands.at(-1)!.op).toBe("set_policy_card");
    expect(commands.filter((c) => c.op === "set_policy_card")).toHaveLength(1);
  });

  it("native op(s) ALWAYS precede the single card op (INV-01)", () => {
    const commands = planNativeAnnotationWithCard(makeEntry(), {});
    const cardIdx = commands.findIndex((c) => c.op === "set_policy_card");
    const lastNativeIdx = commands
      .map((c, i) => (c.op === "set_native_annotation" ? i : -1))
      .filter((i) => i >= 0)
      .at(-1)!;
    expect(lastNativeIdx).toBeLessThan(cardIdx);
  });

  it("the card op carries the frame anchor and the column-mapped table payload", () => {
    const commands = planNativeAnnotationWithCard(
      makeEntry({
        states: [
          { state: "loading", trigger: "제출 직후", result: "스피너" },
        ] as unknown as ManifestEntry["states"],
      }),
      {},
    );
    const cardCmd = commands.find((c) => c.op === "set_policy_card")!;
    expect((cardCmd.args as { frameId: string }).frameId).toBe("10:0");
    const tables = (cardCmd.args as { tables: Array<{ section: string; rows: string[][] }> }).tables;
    const states = tables.find((t) => t.section === "states")!;
    expect(states.rows[0]).toEqual(["loading", "제출 직후", "스피너"]);
  });
});

describe("plan-emit composite — card op literal is distinct (S8, REQ-13)", () => {
  it("the card op is never set_annotation_card and never set_native_annotation-as-card", () => {
    const commands = planNativeAnnotationWithCard(makeEntry(), {});
    const cardCmd = commands.find((c) => c.op === "set_policy_card")!;
    expect(cardCmd.op).toBe("set_policy_card");
    // SPEC-FIGMA-022 — the legacy text-card op was renamed to set_annotation_card.
    expect(cardCmd.op).not.toBe("set_annotation_card");
    expect(cardCmd.op).not.toBe("set_native_annotation");
  });

  it("no command emitted by the composite target uses the legacy card op set_annotation_card", () => {
    const commands = planNativeAnnotationWithCard(makeEntry(), {});
    expect(commands.some((c) => c.op === "set_annotation_card")).toBe(false);
  });

  it("TARGET_TO_OP maps the composite to its primary native op; set_policy_card is a registered op", () => {
    expect(TARGET_TO_OP.native_annotation_with_card).toBe("set_native_annotation");
    expect(PLUGIN_COMMAND_OPS).toContain("set_policy_card");
  });

  it("planAnnotationCard still returns exactly three set_annotation_card commands (create/set-text/attach-link)", () => {
    // S8 byte-behavior guard: the composite must not alter the AC-S8 card path.
    const cardCommands = planAnnotationCard(
      makeEntry({ write_target: "annotation_card" }),
    );
    expect(cardCommands).toHaveLength(3);
    // SPEC-FIGMA-022 — card op renamed from set_annotation to set_annotation_card.
    expect(cardCommands.every((c) => c.op === "set_annotation_card")).toBe(true);
    const steps = cardCommands.map((c) => (c.args as { step?: string }).step);
    expect(steps).toEqual(["create-node", "set-text", "attach-link"]);
  });
});
