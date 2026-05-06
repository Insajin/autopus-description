/**
 * SPEC-FIGMA-002 REQ-01 — derive an ASCII-safe screen_id from a Figma frame name.
 *
 * The output MUST match `^[A-Z][A-Z0-9_-]{1,63}$` so the manifest's frames[].screen_id
 * passes AC-S7 schema validation. Both the use_figma adapter and the
 * figma-developer-mcp adapter MUST share this single implementation; otherwise the
 * AC-S9 substitutability oracle would compare two slightly different normalizations.
 */
export function deriveScreenId(name: string, index: number): string {
  const ascii = name
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "-")
    .replace(/^[^A-Z]+/, "");
  const fallback = `FRAME-${String(index + 1).padStart(2, "0")}`;
  const safe = ascii.length >= 2 ? ascii.slice(0, 64) : fallback;
  return /^[A-Z][A-Z0-9_-]{1,63}$/.test(safe) ? safe : fallback;
}
