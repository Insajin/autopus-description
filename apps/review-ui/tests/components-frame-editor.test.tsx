// @vitest-environment jsdom
// SPEC-FIGMA-004 W4 unit — FrameEditor component (REQ-02, REQ-15).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import FrameEditor from "../src/components/FrameEditor.js";
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
    states: ["default", "validating"],
    edge_cases: ["네트워크 끊김"],
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

describe("FrameEditor", () => {
  it("pre-populates fields from the entry", () => {
    const entry = makeEntry();
    render(<FrameEditor entry={entry} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(
      (screen.getByLabelText(/Title/) as HTMLInputElement).value,
    ).toBe("로그인");
    expect(
      (screen.getByLabelText(/^Intent/) as HTMLTextAreaElement).value,
    ).toBe("사용자 인증 게이트");
    expect(
      (screen.getByLabelText(/States/) as HTMLTextAreaElement).value,
    ).toBe("default\nvalidating");
  });

  it("calls onSave with the updated entry when Save is clicked with valid intent", () => {
    const onSave = vi.fn();
    const entry = makeEntry();
    render(<FrameEditor entry={entry} onSave={onSave} onCancel={vi.fn()} />);

    const titleField = screen.getByLabelText(/Title/) as HTMLInputElement;
    fireEvent.change(titleField, { target: { value: "로그인 v2" } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      screen_id: "AUTH-01",
      title: "로그인 v2",
      intent: "사용자 인증 게이트",
    });
  });

  it("blocks save and surfaces an error when intent is empty (REQ-02 validation)", () => {
    const onSave = vi.fn();
    const entry = makeEntry();
    render(<FrameEditor entry={entry} onSave={onSave} onCancel={vi.fn()} />);

    const intentField = screen.getByLabelText(/^Intent/) as HTMLTextAreaElement;
    fireEvent.change(intentField, { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/intent/);
  });

  it("invokes onCancel when Cancel is clicked, without firing onSave", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<FrameEditor entry={makeEntry()} onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("splits multiline states/edge_cases into trimmed arrays on save", () => {
    const onSave = vi.fn();
    render(
      <FrameEditor
        entry={makeEntry({ states: [], edge_cases: [] })}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/States/), {
      target: { value: "  alpha  \nbeta\n\n   \ngamma" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].states).toEqual(["alpha", "beta", "gamma"]);
  });
});
