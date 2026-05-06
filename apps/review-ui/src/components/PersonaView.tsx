// SPEC-FIGMA-004 W4 — PersonaView selector + React component (REQ-09, INV-004).
//
// AC-S12 oracle: on `samples/persona-render-fixture.json` frames[0] the
// rendered field set per persona must equal these subsets exactly.
// The fixture intentionally restricts annotations to the 7 fields below
// (see `acceptance.md` "Fixture scope note" — verbatim quote from FIGMA-001
// AC-S6). `renderPersonaView` is the pure selector consumed by the test;
// `PersonaView` wraps the selector for dashboard rendering.

"use client";

import type { Persona } from "../lib/persona-parser.js";
import { parsePersonaTags } from "../lib/persona-parser.js";

export type { Persona };

export const CANONICAL_PERSONA_MAP: ReadonlyArray<{
  field: string;
  personas: ReadonlyArray<Persona>;
}> = [
  { field: "intent", personas: ["pm", "designer", "dev", "qa"] },
  { field: "user_value", personas: ["pm"] },
  { field: "states", personas: ["qa", "dev"] },
  { field: "component_refs", personas: ["dev"] },
  { field: "design_tokens", personas: ["designer"] },
  { field: "confidence", personas: ["pm", "designer"] },
  { field: "token_usage", personas: ["pm"] },
];

export interface RenderPersonaArgs {
  frame: Record<string, unknown>;
  persona: Persona;
}

function inlineFieldPersonas(
  frame: Record<string, unknown>,
): Record<string, Persona[]> | null {
  const descriptions = frame["__field_descriptions"];
  if (!descriptions || typeof descriptions !== "object") return null;
  const out: Record<string, Persona[]> = {};
  for (const [field, desc] of Object.entries(
    descriptions as Record<string, unknown>,
  )) {
    if (typeof desc !== "string") continue;
    const tags = parsePersonaTags(desc);
    if (tags.length > 0) out[field] = tags;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function renderPersonaView(args: RenderPersonaArgs): string[] {
  const { frame, persona } = args;
  const inline = inlineFieldPersonas(frame);
  const fields: string[] = [];
  if (inline) {
    for (const [field, personas] of Object.entries(inline)) {
      if (personas.includes(persona) && field in frame) fields.push(field);
    }
  } else {
    for (const { field, personas } of CANONICAL_PERSONA_MAP) {
      if (personas.includes(persona) && field in frame) fields.push(field);
    }
  }
  return fields.sort();
}

export interface PersonaViewProps {
  frame: Record<string, unknown>;
  persona: Persona;
}

export default function PersonaView({ frame, persona }: PersonaViewProps) {
  const fields = renderPersonaView({ frame, persona });
  if (fields.length === 0) {
    return <p className="persona-view-empty">표시할 필드가 없습니다.</p>;
  }
  return (
    <dl className="persona-view" data-persona={persona}>
      {fields.map((field) => (
        <div key={field} className="persona-view-row">
          <dt className="persona-view-label">{field}</dt>
          <dd className="persona-view-value">{formatValue(frame[field])}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "-";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
