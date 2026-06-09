// @vitest-environment jsdom
// SPEC-FIGMA-004 W4 unit — PersonaView component + selector (REQ-09, INV-004).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import PersonaView, {
  renderPersonaView,
  CANONICAL_PERSONA_MAP,
} from "../src/components/PersonaView.js";

afterEach(() => cleanup());

const fixtureFrame = {
  intent: "사용자 인증",
  user_value: "PM 진입",
  states: ["default", "validating"],
  component_refs: ["LoginForm"],
  design_tokens: ["color/primary/500"],
  confidence: 0.9,
  token_usage: { input_tokens: 0, output_tokens: 0 },
};

describe("renderPersonaView (canonical mapping path)", () => {
  it("returns the qa subset sorted ascending", () => {
    expect(renderPersonaView({ frame: fixtureFrame, persona: "qa" })).toEqual(
      ["intent", "states"],
    );
  });

  it("returns the designer subset", () => {
    expect(
      renderPersonaView({ frame: fixtureFrame, persona: "designer" }),
    ).toEqual(["confidence", "design_tokens", "intent"]);
  });

  it("returns the dev subset", () => {
    expect(renderPersonaView({ frame: fixtureFrame, persona: "dev" })).toEqual([
      "component_refs",
      "intent",
      "states",
    ]);
  });

  it("returns the pm subset", () => {
    expect(renderPersonaView({ frame: fixtureFrame, persona: "pm" })).toEqual([
      "confidence",
      "intent",
      "token_usage",
      "user_value",
    ]);
  });

  it("skips fields absent from the frame", () => {
    const sparseFrame = { intent: "x" };
    expect(renderPersonaView({ frame: sparseFrame, persona: "pm" })).toEqual([
      "intent",
    ]);
  });
});

describe("renderPersonaView (inline marker override)", () => {
  it("uses inline persona_tags markers when present in __field_descriptions", () => {
    const frame = {
      intent: "x",
      states: ["a"],
      __field_descriptions: {
        intent: "intent description [persona_tags: pm, qa]",
        states: "states description [persona_tags: dev]",
      },
    };
    expect(renderPersonaView({ frame, persona: "qa" })).toEqual(["intent"]);
    expect(renderPersonaView({ frame, persona: "dev" })).toEqual(["states"]);
  });
});

describe("PersonaView component", () => {
  it("renders a definition list of field names for the requested persona", () => {
    const { container } = render(
      <PersonaView frame={fixtureFrame} persona="qa" />,
    );
    expect(container.querySelector("dl[data-persona=qa]")).toBeTruthy();
    expect(screen.getByText("intent")).toBeTruthy();
    expect(screen.getByText("states")).toBeTruthy();
  });

  it("renders a placeholder when no fields match", () => {
    render(<PersonaView frame={{}} persona="qa" />);
    expect(screen.getByText("표시할 필드가 없습니다.")).toBeTruthy();
  });
});

describe("CANONICAL_PERSONA_MAP", () => {
  it("contains exactly 8 entries including open_questions", () => {
    expect(CANONICAL_PERSONA_MAP.map((e) => e.field).sort()).toEqual([
      "component_refs",
      "confidence",
      "design_tokens",
      "intent",
      "open_questions",
      "states",
      "token_usage",
      "user_value",
    ]);
  });
});
