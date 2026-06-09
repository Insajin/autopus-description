// @vitest-environment jsdom
// SPEC-FIGMA-018 T9 — FrameRow native_annotation surface scaffold (RED).
// Covers S11 (REQ-09): write_target "native_annotation" renders the value AND
// a Dev-Mode-only hint; other targets render WITHOUT the hint.
//
// Render harness: @testing-library/react (matching the existing
// apps/review-ui/tests/components-frame-row.test.tsx setup; jsdom env, cleanup
// after each test).
//
// RED expectation: FrameRow (T8) does not render the Dev-Mode hint yet, and
// "native_annotation" is not yet a valid WriteTarget (T1), so this FAILS on the
// missing-hint assertion (and/or a type error for the write_target value).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import FrameRow from "../src/components/FrameRow.js";
import type { ManifestEntry } from "@autopus/write-router/types";

afterEach(() => cleanup());

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증 게이트",
    user_value: "PM 진입",
    success_criteria: "5초",
    states: ["default"],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "h",
    write_target: "native_annotation",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

function renderRow(entry: ManifestEntry) {
  return render(
    <FrameRow
      entry={entry}
      onApply={vi.fn()}
      onEdit={vi.fn()}
      onSkip={vi.fn()}
      onEscalate={vi.fn()}
      isApplied={false}
      isStale={false}
      slackConfigured={true}
    />,
  );
}

describe("FrameRow native_annotation surface (S11 / REQ-09)", () => {
  it("renders the write_target value 'native_annotation'", () => {
    renderRow(makeEntry());
    expect(screen.getByText("native_annotation")).toBeTruthy();
  });

  it("renders an adjacent Dev-Mode-only-visibility hint for native_annotation", () => {
    const { container } = renderRow(makeEntry());
    const hint =
      screen.queryByText(/Dev Mode/i) ??
      container.querySelector('[data-native-hint], .native-annotation-hint');
    expect(hint).toBeTruthy();
  });

  it("does NOT render the Dev-Mode hint for other write_target values", () => {
    const { container } = renderRow(makeEntry({ write_target: "annotation_card" }));
    const hint =
      screen.queryByText(/Dev Mode/i) ??
      container.querySelector('[data-native-hint], .native-annotation-hint');
    expect(hint).toBeNull();
  });
});
