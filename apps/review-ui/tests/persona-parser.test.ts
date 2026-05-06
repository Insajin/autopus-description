// SPEC-FIGMA-004 W4 unit — canonical persona-tag parser (REQ-09, INV-004).

import { describe, it, expect } from "vitest";
import {
  parsePersonaTags,
  isKnownPersona,
  PERSONA_TAGS_REGEX,
} from "../src/lib/persona-parser.js";

describe("parsePersonaTags", () => {
  it("returns the trimmed, deduped, lowercased token set", () => {
    expect(parsePersonaTags("[persona_tags: pm, designer]").sort()).toEqual([
      "designer",
      "pm",
    ]);
  });

  it("tolerates extra whitespace and casing irregularities", () => {
    expect(
      parsePersonaTags("[persona_tags:   pm,  qa  ]").sort(),
    ).toEqual(["pm", "qa"]);
  });

  it("dedupes repeated tokens within the same marker", () => {
    expect(parsePersonaTags("[persona_tags: pm, pm, pm]")).toEqual(["pm"]);
  });

  it("filters out tokens outside the canonical {pm, designer, qa, dev} set", () => {
    expect(
      parsePersonaTags("[persona_tags: pm, marketing, ops]"),
    ).toEqual(["pm"]);
  });

  it("returns [] when no marker is present", () => {
    expect(parsePersonaTags("plain prose without marker")).toEqual([]);
  });

  it("returns [] for non-string or empty input", () => {
    expect(parsePersonaTags("")).toEqual([]);
    expect(parsePersonaTags(undefined as unknown as string)).toEqual([]);
  });

  it("only honours the first marker in a string", () => {
    expect(
      parsePersonaTags(
        "first [persona_tags: pm] second [persona_tags: dev]",
      ),
    ).toEqual(["pm"]);
  });
});

describe("isKnownPersona", () => {
  it("accepts the canonical four", () => {
    for (const p of ["pm", "designer", "qa", "dev"]) {
      expect(isKnownPersona(p)).toBe(true);
    }
  });

  it("rejects unknown tokens", () => {
    expect(isKnownPersona("marketing")).toBe(false);
    expect(isKnownPersona("PM")).toBe(false);
  });
});

describe("PERSONA_TAGS_REGEX", () => {
  it("matches SPEC-FIGMA-001 § 4.1 canonical pattern", () => {
    expect(PERSONA_TAGS_REGEX.source).toBe(
      "\\[persona_tags:\\s*([a-z,\\s]+)\\]",
    );
  });
});
