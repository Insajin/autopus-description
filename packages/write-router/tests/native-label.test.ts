// SPEC-FIGMA-018 T9 — native-label scaffold (RED).
// Covers S9 (REQ-10 budget/truncation oracle) plus composeAreaLabel /
// composeFrameLabel content assertions feeding S1/S2/S8.
//
// RED expectation: ../src/native-label.js does not exist yet (T2). This file
// must FAIL with a module-not-found / unresolved-import error until T2 lands.

import { describe, it, expect } from "vitest";
import {
  composeAreaLabel,
  composeFrameLabel,
  truncateLabel,
} from "../src/native-label.js";
import type { AreaAnnotation, ManifestEntry } from "../src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "20:0",
    title: "로그인",
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

function makeArea(overrides: Partial<AreaAnnotation> = {}): AreaAnnotation {
  return {
    area_id: "1",
    title: "검색",
    target_area: "검색 바",
    description: "입력한 조건으로 목록을 갱신한다",
    ...overrides,
  };
}

describe("composeAreaLabel (REQ-02 / S1 feed)", () => {
  it("includes the area title and description in the labelMarkdown", () => {
    const label = composeAreaLabel(makeArea());
    expect(label).toContain("검색");
    expect(label).toContain("입력한 조건으로 목록을 갱신한다");
  });

  it("includes interaction and states when present", () => {
    const label = composeAreaLabel(
      makeArea({
        interaction: "Enter와 검색 아이콘은 동일한 실행으로 본다",
        states: ["로딩", "빈 결과"],
      }),
    );
    expect(label).toContain("Enter와 검색 아이콘은 동일한 실행으로 본다");
    expect(label).toContain("로딩");
    expect(label).toContain("빈 결과");
  });

  it("omits empty optional fields (no dangling labels for absent interaction)", () => {
    const label = composeAreaLabel(
      makeArea({ interaction: "", states: [] }),
    );
    // Only title/target_area/description content present.
    expect(label).toContain("검색");
    expect(label).toContain("입력한 조건으로 목록을 갱신한다");
    // No empty bracket/section leftover for the omitted interaction field.
    expect(label).not.toMatch(/상호작용[:：]\s*$/m);
  });
});

describe("composeFrameLabel (REQ-03 / S2 feed)", () => {
  it("summarizes intent, user_value, and success_criteria", () => {
    const label = composeFrameLabel(makeEntry());
    expect(label).toContain("사용자 인증 게이트");
    expect(label).toContain("PM 진입");
    expect(label).toContain("5초");
  });
});

describe("truncateLabel (S9 / REQ-10 oracle)", () => {
  it("leaves a label within budget unchanged", () => {
    const short = "검색 영역 설명";
    expect(truncateLabel(short, 500)).toBe(short);
  });

  it("truncates an oversized label to at most the budget and ends with the continuation indicator", () => {
    const oversized = "가".repeat(800);
    const out = truncateLabel(oversized, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith("…")).toBe(true);
  });

  it("a composed area label exceeding 500 chars is truncated to <= 500 ending with …", () => {
    const huge = makeArea({ description: "갱신".repeat(600) });
    const composed = composeAreaLabel(huge);
    const out = truncateLabel(composed, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith("…")).toBe(true);
  });
});
