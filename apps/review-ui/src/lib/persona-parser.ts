// SPEC-FIGMA-004 W4 — canonical persona-tag parser (REQ-09, INV-004).
//
// Byte-for-byte port of SPEC-FIGMA-001 § 4.1 (`research.md` D2):
//   regex:    \[persona_tags:\s*([a-z,\s]+)\]
//   tokens:   {pm, designer, qa, dev}
//   pipeline: capture group 1 → split on comma → trim → lowercase → dedupe
//             → drop unknown tokens → return as a sorted array
//
// Returning an array (not a Set) is intentional so callers can `.sort()` and
// compare against AC-S12's expected ordered field lists; persona-view-oracle
// asserts equality after `.sort()` on the result.

export type Persona = "pm" | "designer" | "qa" | "dev";

export const PERSONA_TAGS_REGEX = /\[persona_tags:\s*([a-z,\s]+)\]/;

const KNOWN_PERSONAS: ReadonlySet<Persona> = new Set([
  "pm",
  "designer",
  "qa",
  "dev",
]);

export function parsePersonaTags(input: string): Persona[] {
  if (typeof input !== "string" || input.length === 0) return [];
  const match = PERSONA_TAGS_REGEX.exec(input);
  if (!match) return [];
  const seen = new Set<Persona>();
  for (const raw of match[1].split(",")) {
    const token = raw.trim().toLowerCase();
    if (KNOWN_PERSONAS.has(token as Persona)) {
      seen.add(token as Persona);
    }
  }
  return [...seen];
}

export function isKnownPersona(value: string): value is Persona {
  return KNOWN_PERSONAS.has(value as Persona);
}
