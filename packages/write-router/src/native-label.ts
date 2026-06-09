// SPEC-FIGMA-018 T2 — native annotation label composer (REQ-02, REQ-03, REQ-10).
//
// Produces concise `labelMarkdown` strings for the native Dev-Mode annotation
// primitive. This is deliberately distinct from the rich multi-section card
// composer (`renderAnnotationText` in annotation-text.ts): native annotations
// are anchored to a node and read inline, so the label stays compact and omits
// every empty optional field.

import type { AreaAnnotation, ManifestEntry } from "./types.js";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pushLine(lines: string[], label: string, value?: string): void {
  if (hasText(value)) lines.push(`${label}: ${value.trim()}`);
}

function pushList(lines: string[], label: string, values?: string[]): void {
  const filtered = (values ?? []).filter(hasText);
  if (filtered.length > 0) lines.push(`${label}: ${filtered.join(", ")}`);
}

// Concise per-area label. Title is the heading; remaining fields are appended
// only when present so no dangling "상호작용:" leftover survives for an absent
// optional field (native-label.test.ts omit-empty assertion).
export function composeAreaLabel(area: AreaAnnotation): string {
  const lines = [`**${area.title}**`];
  pushLine(lines, "영역", area.target_area);
  pushLine(lines, "설명", area.description);
  pushLine(lines, "상호작용", area.interaction);
  pushLine(lines, "정책", area.policy);
  pushList(lines, "상태", area.states);
  return lines.join("\n");
}

// Frame-level summary used when an entry carries no area_annotations (REQ-03).
export function composeFrameLabel(entry: ManifestEntry): string {
  const lines = [`**${entry.title}**`];
  pushLine(lines, "목적", entry.intent);
  pushLine(lines, "사용자 가치", entry.user_value);
  pushLine(lines, "성공 기준", entry.success_criteria);
  return lines.join("\n");
}

// REQ-10 — truncate to the budget with a single continuation indicator.
// Length is measured in code units to match the configured budget contract;
// the final string (including the trailing "…") never exceeds `budget`.
// @AX:NOTE [AUTO]: budget is measured in UTF-16 code units (String.length), not grapheme clusters, to match the configured budget contract (REQ-10). The returned string including the trailing "…" never exceeds `budget`.
export function truncateLabel(label: string, budget: number): string {
  if (label.length <= budget) return label;
  const ELLIPSIS = "…";
  const keep = Math.max(0, budget - ELLIPSIS.length);
  return label.slice(0, keep) + ELLIPSIS;
}
