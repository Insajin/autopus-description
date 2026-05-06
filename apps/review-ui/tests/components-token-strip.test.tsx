// @vitest-environment jsdom
// SPEC-FIGMA-004 Phase 3 — TokenStrip component coverage (REQ-23).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import TokenStrip from "../src/components/TokenStrip.js";

afterEach(() => cleanup());

describe("TokenStrip component", () => {
  it("formats finite numeric token cost in K-units to one decimal", () => {
    render(<TokenStrip totalTokenCost={145000} />);
    expect(screen.getByText(/145\.0K/)).toBeTruthy();
  });

  it("renders 0K when totalTokenCost is undefined", () => {
    render(<TokenStrip />);
    expect(screen.getByText(/0K/)).toBeTruthy();
  });

  it("renders 0K when totalTokenCost is NaN", () => {
    render(<TokenStrip totalTokenCost={Number.NaN} />);
    expect(screen.getByText(/0K/)).toBeTruthy();
  });

  it("renders pilotDate badge when pilotDate is provided", () => {
    render(<TokenStrip totalTokenCost={1000} pilotDate="2026-05-10" />);
    expect(screen.getByText(/파일럿 일자: 2026-05-10/)).toBeTruthy();
  });

  it("does not render pilotDate badge when pilotDate is undefined", () => {
    const { container } = render(<TokenStrip totalTokenCost={1000} />);
    expect(container.textContent).not.toContain("파일럿 일자");
  });

  it("renders reviewerId badge when provided and omits it when undefined", () => {
    const { rerender, container } = render(
      <TokenStrip totalTokenCost={1000} reviewerId="pm-test" />,
    );
    expect(container.textContent).toContain("PM: pm-test");
    rerender(<TokenStrip totalTokenCost={1000} />);
    expect(container.textContent).not.toContain("PM:");
  });
});
