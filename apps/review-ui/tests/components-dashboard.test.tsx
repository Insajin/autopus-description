// @vitest-environment jsdom
// SPEC-FIGMA-004 Phase 3 — Dashboard component coverage.
// Stubs global fetch so the API-route round trips are observable without
// actually starting the Next.js server.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import Dashboard from "../src/components/Dashboard.js";
import type { ManifestEntry } from "@autopus/write-router/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

describe("Dashboard component", () => {
  it("renders TokenStrip with formatted token cost and one frame row", () => {
    render(
      <Dashboard
        frames={[makeEntry({ screen_id: "AUTH-01" })]}
        totalTokenCost={145000}
        pilotDate="2026-05-10"
        reviewerId="pm-test"
      />,
    );
    expect(screen.getByText(/145\.0K/)).toBeTruthy();
    expect(screen.getByText("AUTH-01")).toBeTruthy();
  });

  it("renders StaleBadge when staleScreenIds is non-empty", () => {
    render(
      <Dashboard
        frames={[makeEntry({ screen_id: "AUTH-01" })]}
        staleScreenIds={["AUTH-01", "DASH-01", "PROF-01", "BIL-01"]}
      />,
    );
    expect(screen.getByText(/4 frames stale — review batch/)).toBeTruthy();
  });

  it("does not render StaleBadge when staleScreenIds is empty", () => {
    const { container } = render(
      <Dashboard frames={[makeEntry()]} staleScreenIds={[]} />,
    );
    expect(container.textContent).not.toContain("review batch");
    expect(container.textContent).not.toContain("stale");
  });

  it("posts to /api/apply when Apply button is clicked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "applied", write_id: "wr-1" }),
    } as Response);

    render(<Dashboard frames={[makeEntry({ screen_id: "AUTH-01" })]} />);
    const applyBtn = screen.getByRole("button", { name: /Apply/i });
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/apply",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("posts skip action to /api/feedback when Skip button is clicked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "recorded" }),
    } as Response);

    render(<Dashboard frames={[makeEntry({ screen_id: "AUTH-01" })]} />);
    const skipBtn = screen.getByRole("button", { name: /Skip/i });
    await act(async () => {
      fireEvent.click(skipBtn);
    });

    const calls = fetchSpy.mock.calls.filter((c) => c[0] === "/api/feedback");
    expect(calls).toHaveLength(1);
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("skip");
    expect(body.screen_id).toBe("AUTH-01");
  });

  it("posts escalate action when Escalate is enabled (slackConfigured=true)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "recorded" }),
    } as Response);

    render(
      <Dashboard
        frames={[makeEntry({ screen_id: "AUTH-01", intent_mismatch: true })]}
        slackConfigured={true}
      />,
    );
    const escalateBtn = screen.getByRole("button", { name: /Escalate/i });
    await act(async () => {
      fireEvent.click(escalateBtn);
    });

    const calls = fetchSpy.mock.calls.filter((c) => c[0] === "/api/feedback");
    expect(calls).toHaveLength(1);
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("escalate");
  });

  it("swaps a row into FrameEditor when Edit is clicked, then back via Cancel", () => {
    render(<Dashboard frames={[makeEntry({ screen_id: "AUTH-01" })]} />);
    const editBtn = screen.getByRole("button", { name: /Edit/i });
    fireEvent.click(editBtn);
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeTruthy();

    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole("button", { name: /Cancel/i })).toBeNull();
  });

  it("renders multiple frames in a list with one li per entry", () => {
    const { container } = render(
      <Dashboard
        frames={[
          makeEntry({ screen_id: "AUTH-01", frame_id: "1:1" }),
          makeEntry({ screen_id: "DASH-01", frame_id: "2:2" }),
          makeEntry({ screen_id: "PROF-01", frame_id: "3:3" }),
        ]}
      />,
    );
    const items = container.querySelectorAll("li.frame-list-item");
    expect(items).toHaveLength(3);
  });
});
