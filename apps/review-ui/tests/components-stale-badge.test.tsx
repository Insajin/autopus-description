// @vitest-environment jsdom
// SPEC-FIGMA-004 W4 unit — StaleBadge component (REQ-10, REQ-21).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import StaleBadge from "../src/components/StaleBadge.js";

afterEach(() => cleanup());

describe("StaleBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<StaleBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders inline 'stale' label when count <= 3", () => {
    render(<StaleBadge count={2} screenIds={["A", "B"]} />);
    const badge = screen.getByText("stale");
    expect(badge.getAttribute("data-mode")).toBe("inline");
  });

  it("renders digest banner with 'review batch' summary when count > 3", () => {
    render(
      <StaleBadge count={5} screenIds={["A", "B", "C", "D", "E"]} />,
    );
    expect(screen.getByText("5 frames stale — review batch")).toBeTruthy();
    expect(screen.getByText("Show details")).toBeTruthy();
  });

  it("expands the screen_id list when 'Show details' is clicked", () => {
    render(
      <StaleBadge count={4} screenIds={["A", "B", "C", "D"]} />,
    );
    expect(screen.queryByText("A")).toBeNull();
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("D")).toBeTruthy();
    expect(screen.getByText("Hide details")).toBeTruthy();
  });

  it("collapses again when toggled twice", () => {
    render(
      <StaleBadge count={4} screenIds={["A", "B", "C", "D"]} />,
    );
    const toggle = screen.getByText("Show details");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText("Hide details"));
    expect(screen.queryByText("A")).toBeNull();
  });
});
