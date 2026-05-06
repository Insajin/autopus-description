// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S12 persona view oracle.
// REQ-09, INV-004. Reuses SPEC-FIGMA-001 fixture samples/persona-render-fixture.json byte-for-byte.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

import { parsePersonaTags } from "@autopus/review-ui/lib/persona-parser";
import { renderPersonaView } from "@autopus/review-ui/components/PersonaView";

import { PERSONA_FIXTURE } from "./_helpers.js";

describe("AC-S12: persona view oracle (REQ-09, INV-004)", () => {
  it("fixture file exists at the SPEC-FIGMA-001 canonical path", () => {
    expect(existsSync(PERSONA_FIXTURE)).toBe(true);
  });

  it("canonical regex parses '[persona_tags: pm, designer]' to normalized set {pm, designer}", () => {
    const got = parsePersonaTags("[persona_tags: pm, designer]");
    expect(got.sort()).toEqual(["designer", "pm"]);
  });

  it("canonical regex tolerates whitespace-padded tokens", () => {
    const got = parsePersonaTags("[persona_tags:   pm,  qa  ]");
    expect(got.sort()).toEqual(["pm", "qa"]);
  });

  it("canonical regex rejects unknown tokens (token set is {pm, designer, qa, dev})", () => {
    const got = parsePersonaTags("[persona_tags: pm, marketing]");
    expect(got.sort()).toEqual(["pm"]);
  });

  // -----------------------------------------------------------------------
  // AC-S12 oracle: rendered field set must match exactly per persona on
  // samples/persona-render-fixture.json frames[0]. Field-level persona_tags
  // map (fixture-scoped):
  //   intent:        [pm, designer, dev, qa]
  //   user_value:    [pm]
  //   states:        [qa, dev]
  //   component_refs:[dev]
  //   design_tokens: [designer]
  //   confidence:    [pm, designer]
  //   token_usage:   [pm]
  // -----------------------------------------------------------------------

  it("persona='qa' renders exactly {intent, states} sorted ascending", () => {
    const fixture = JSON.parse(readFileSync(PERSONA_FIXTURE, "utf8"));
    const fields = renderPersonaView({ frame: fixture.frames[0], persona: "qa" });
    expect(fields.sort()).toEqual(["intent", "states"]);
    expect(fields).not.toContain("user_value");
    expect(fields).not.toContain("component_refs");
    expect(fields).not.toContain("design_tokens");
    expect(fields).not.toContain("token_usage");
  });

  it("persona='designer' renders exactly {confidence, design_tokens, intent} sorted ascending", () => {
    const fixture = JSON.parse(readFileSync(PERSONA_FIXTURE, "utf8"));
    const fields = renderPersonaView({ frame: fixture.frames[0], persona: "designer" });
    expect(fields.sort()).toEqual(["confidence", "design_tokens", "intent"]);
  });

  it("persona='dev' renders exactly {component_refs, intent, states} sorted ascending", () => {
    const fixture = JSON.parse(readFileSync(PERSONA_FIXTURE, "utf8"));
    const fields = renderPersonaView({ frame: fixture.frames[0], persona: "dev" });
    expect(fields.sort()).toEqual(["component_refs", "intent", "states"]);
  });

  it("persona='pm' renders exactly {confidence, intent, token_usage, user_value} sorted ascending", () => {
    const fixture = JSON.parse(readFileSync(PERSONA_FIXTURE, "utf8"));
    const fields = renderPersonaView({ frame: fixture.frames[0], persona: "pm" });
    expect(fields.sort()).toEqual(["confidence", "intent", "token_usage", "user_value"]);
  });
});
