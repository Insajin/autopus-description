// SPEC-FIGMA-018 T9 — plan-emit native annotation scaffold (RED).
// Covers S10 (every emitted op is "set_native_annotation", none "set_annotation";
// TARGET_TO_OP maps native_annotation → set_native_annotation) and S12
// non-regression (planAnnotationCard still emits 3 set_annotation commands).
//
// RED expectation: ../src/plan-emit/native-annotation-plan.js does not exist
// yet (T5) and TARGET_TO_OP has no native_annotation key yet (T6).

import { describe, it, expect } from "vitest";
import { planNativeAnnotation } from "../src/plan-emit/native-annotation-plan.js";
import { TARGET_TO_OP } from "../src/plan-emit/types.js";
// Non-regression import: the card plan-emit must remain unchanged (S12).
import { planAnnotationCard } from "../src/plan-emit/annotation-card-plan.js";
import type { ManifestEntry } from "../src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "70:0",
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
    write_target: "native_annotation",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}

describe("planNativeAnnotation (S10 / REQ-01, REQ-02)", () => {
  it("emits only set_native_annotation ops, never set_annotation", () => {
    const entry = makeEntry({
      area_annotations: [
        {
          area_id: "1",
          title: "결과",
          target_area: "결과 리스트",
          description: "검색 결과를 표시한다",
        },
      ],
    });
    const cmds = planNativeAnnotation(entry, { frameNodeName: "검색 화면" });
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    for (const cmd of cmds) {
      expect(cmd.op).toBe("set_native_annotation");
    }
    expect(cmds.some((c) => c.op === "set_annotation")).toBe(false);
  });

  it("each command carries nodeId and labelMarkdown args", () => {
    const entry = makeEntry({
      area_annotations: [
        {
          area_id: "1",
          title: "결과",
          target_area: "결과 리스트",
          description: "검색 결과를 표시한다",
        },
      ],
    });
    const cmds = planNativeAnnotation(entry, { frameNodeName: "검색 화면" });
    const args = cmds[0].args as Record<string, unknown>;
    expect(args.nodeId).toBeDefined();
    expect(typeof args.labelMarkdown).toBe("string");
  });

  it("TARGET_TO_OP maps native_annotation to set_native_annotation", () => {
    expect(
      (TARGET_TO_OP as Record<string, string>).native_annotation,
    ).toBe("set_native_annotation");
  });
});

describe("planNativeAnnotation — frame-level + categoryId branches", () => {
  // Branches [53]/[54]: a no-area entry emits a single frame-level command on
  // the frame node, summarizing the entry (REQ-03 parity with the adapter).
  it("REQ-03: a no-area entry emits one frame-level set_native_annotation command", () => {
    const entry = makeEntry({ frame_id: "71:0", area_annotations: [] });
    const cmds = planNativeAnnotation(entry, { frameNodeName: "검색 화면" });
    expect(cmds).toHaveLength(1);
    expect(cmds[0].op).toBe("set_native_annotation");
    const args = cmds[0].args as Record<string, unknown>;
    expect(args.nodeId).toBe("71:0");
    expect(String(args.labelMarkdown)).toContain("사용자 인증 게이트");
  });

  // Branch [53] nullish arm: area_annotations undefined (not []) still resolves
  // to the frame-level path.
  it("REQ-03: an entry with area_annotations undefined emits one frame-level command", () => {
    const entry = makeEntry({ frame_id: "75:0" }); // area_annotations omitted → undefined
    const cmds = planNativeAnnotation(entry, { frameNodeName: "검색 화면" });
    expect(cmds).toHaveLength(1);
    expect((cmds[0].args as Record<string, unknown>).nodeId).toBe("75:0");
  });

  // The frameNodeName-absent arm of the single-entry index (still valid plan).
  it("emits a frame-level command even when frameNodeName is omitted", () => {
    const entry = makeEntry({ frame_id: "72:0", area_annotations: [] });
    const cmds = planNativeAnnotation(entry, {});
    expect(cmds).toHaveLength(1);
    expect((cmds[0].args as Record<string, unknown>).nodeId).toBe("72:0");
  });

  // Branches [35]/[69]: an area carrying category_id forwards categoryId on the
  // emitted command, matching the adapter's REQ-11 behavior.
  it("REQ-11: forwards categoryId on the emitted command when the area has category_id", () => {
    const entry = makeEntry({
      frame_id: "73:0",
      area_annotations: [
        {
          area_id: "1",
          title: "결과",
          target_area: "결과 리스트",
          description: "검색 결과를 표시한다",
          category_id: "ready-for-dev",
        } as ManifestEntry["area_annotations"][number],
      ],
    });
    const cmds = planNativeAnnotation(entry, { frameNodeName: "검색 화면" });
    const args = cmds[0].args as Record<string, unknown>;
    expect(args.categoryId).toBe("ready-for-dev");
  });

  // The categoryId-absent arm: no category signal → categoryId key omitted.
  it("omits categoryId when the area carries no category signal", () => {
    const entry = makeEntry({
      frame_id: "74:0",
      area_annotations: [
        {
          area_id: "1",
          title: "결과",
          target_area: "결과 리스트",
          description: "검색 결과를 표시한다",
        },
      ],
    });
    const cmds = planNativeAnnotation(entry, { frameNodeName: "검색 화면" });
    const args = cmds[0].args as Record<string, unknown>;
    expect("categoryId" in args).toBe(false);
  });
});

describe("S12 non-regression: annotation_card decomposition unchanged", () => {
  it("planAnnotationCard still emits exactly three set_annotation commands", () => {
    const cmds = planAnnotationCard(makeEntry({ write_target: "annotation_card" }));
    expect(cmds).toHaveLength(3);
    for (const cmd of cmds) {
      expect(cmd.op).toBe("set_annotation");
    }
  });
});
