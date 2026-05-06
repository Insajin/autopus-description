// @vitest-environment jsdom
// SPEC-FIGMA-004 W4 unit — FrameRow component (REQ-15, REQ-20, AC-S20).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

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
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

function renderRow(props: Partial<Parameters<typeof FrameRow>[0]> = {}) {
  const onApply = vi.fn();
  const onEdit = vi.fn();
  const onSkip = vi.fn();
  const onEscalate = vi.fn();
  const utils = render(
    <FrameRow
      entry={makeEntry()}
      onApply={onApply}
      onEdit={onEdit}
      onSkip={onSkip}
      onEscalate={onEscalate}
      isApplied={false}
      isStale={false}
      slackConfigured={true}
      {...props}
    />,
  );
  return { ...utils, onApply, onEdit, onSkip, onEscalate };
}

describe("FrameRow", () => {
  it("renders screen_id, title, truncated intent, and confidence", () => {
    const entry = makeEntry({ confidence: 0.82 });
    renderRow({ entry });
    expect(screen.getByText("AUTH-01")).toBeTruthy();
    expect(screen.getByText("로그인")).toBeTruthy();
    expect(screen.getByText("0.82")).toBeTruthy();
  });

  it("shows the intent_mismatch badge when entry flags it", () => {
    renderRow({ entry: makeEntry({ intent_mismatch: true }) });
    expect(screen.getByLabelText("intent mismatch")).toBeTruthy();
  });

  it("hides the intent_mismatch badge by default", () => {
    renderRow({ entry: makeEntry({ intent_mismatch: false }) });
    expect(screen.queryByLabelText("intent mismatch")).toBeNull();
  });

  it("applies high-confidence styling at >= 0.85", () => {
    const { container } = renderRow({ entry: makeEntry({ confidence: 0.9 }) });
    expect(container.querySelector(".confidence-high")).toBeTruthy();
  });

  it("applies mid-confidence styling between 0.7 and 0.85", () => {
    const { container } = renderRow({ entry: makeEntry({ confidence: 0.8 }) });
    expect(container.querySelector(".confidence-mid")).toBeTruthy();
  });

  it("applies low-confidence styling under 0.7", () => {
    const { container } = renderRow({ entry: makeEntry({ confidence: 0.5 }) });
    expect(container.querySelector(".confidence-low")).toBeTruthy();
  });

  it("invokes onApply, onEdit, onSkip, onEscalate exactly once on click with the entry", () => {
    const { onApply, onEdit, onSkip, onEscalate } = renderRow();
    fireEvent.click(screen.getByText("Apply"));
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Escalate"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].screen_id).toBe("AUTH-01");
  });

  it("disables Apply when isApplied is true", () => {
    renderRow({ isApplied: true });
    expect(screen.getByText("Apply").hasAttribute("disabled")).toBe(true);
  });

  it("disables Apply when manifestValid is false", () => {
    renderRow({ manifestValid: false });
    expect(screen.getByText("Apply").hasAttribute("disabled")).toBe(true);
  });

  it("disables Escalate when slackConfigured is false (AC-S20) with explanatory tooltip", () => {
    renderRow({ slackConfigured: false });
    const btn = screen.getByText("Escalate");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("title")).toBe("Slack workspace not configured");
  });

  it("truncates intent longer than 120 chars with an ellipsis and tooltip", () => {
    const longIntent = "가".repeat(200);
    const { container } = renderRow({ entry: makeEntry({ intent: longIntent }) });
    const para = container.querySelector(".frame-row-intent")!;
    expect(para.textContent!.endsWith("…")).toBe(true);
    expect(para.getAttribute("title")).toBe(longIntent);
  });
});
