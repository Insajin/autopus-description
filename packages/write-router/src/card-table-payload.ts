// SPEC-FIGMA-020 T3 — table-payload builder for the policy card (REQ-03, REQ-04,
// REQ-06).
//
// Maps a `ManifestEntry` to a `CardTablePayload`: one table per NON-EMPTY policy
// section, each with a fixed header row and one row per source item. The plugin
// renderer (createPolicyCardCanvas, T4) turns this payload into real Figma
// auto-layout cells, so this module stays pure and Figma-free. `states` and
// `edge_cases` are coerced through the T2 normalizers so legacy string items and
// structured objects render in the same columns (REQ-06). Empty sections are
// omitted entirely so the card carries no dangling empty table.

import type {
  AreaAnnotation,
  DataRequirement,
  ManifestEntry,
} from "./types.js";
import {
  normalizeEdgeCase,
  normalizeState,
  type EdgeCaseItem,
  type StateItem,
} from "./structured-policy.js";

// A single table cell, already coerced to a trimmed string by the builder.
export type CardTableCell = string;

// One table row: an ordered tuple of cells matching the table's header columns.
export type CardTableRow = CardTableCell[];

// The policy section a table was built from. Stable keys let the renderer and
// tests address a specific table without relying on array order.
export type CardTableSection =
  | "states"
  | "edge_cases"
  | "data_requirements"
  | "area_annotations";

// One rendered table: a section key, a fixed header row, and one body row per
// source item. `header.length` equals every body row's length (3 columns).
export interface CardTable {
  section: CardTableSection;
  header: CardTableRow;
  rows: CardTableRow[];
}

// The full card payload: zero or more tables, one per non-empty section, in a
// fixed section order (states, edge_cases, data_requirements, area_annotations).
export interface CardTablePayload {
  tables: CardTable[];
}

// Fixed header columns per policy dimension (REQ-04).
const STATE_HEADER: CardTableRow = ["state", "trigger", "result"];
const EDGE_CASE_HEADER: CardTableRow = ["case", "risk", "handling"];
const DATA_REQUIREMENT_HEADER: CardTableRow = ["name", "purpose", "required values"];
const AREA_ANNOTATION_HEADER: CardTableRow = ["area", "description", "policy"];

function cell(value: unknown): CardTableCell {
  return typeof value === "string" ? value.trim() : "";
}

function joinValues(values?: string[]): CardTableCell {
  return (values ?? []).filter((v) => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .join(", ");
}

function stateRows(items: StateItem[]): CardTableRow[] {
  return items.map((item) => {
    const row = normalizeState(item);
    return [row.state, row.trigger, row.result];
  });
}

function edgeCaseRows(items: EdgeCaseItem[]): CardTableRow[] {
  return items.map((item) => {
    const row = normalizeEdgeCase(item);
    return [row.case, row.risk, row.handling];
  });
}

function dataRequirementRows(items: DataRequirement[]): CardTableRow[] {
  return items.map((item) => [
    cell(item.name),
    cell(item.purpose),
    joinValues(item.required_values),
  ]);
}

function areaAnnotationRows(items: AreaAnnotation[]): CardTableRow[] {
  return items.map((item) => [
    cell(item.target_area),
    cell(item.description),
    cell(item.policy),
  ]);
}

function pushTable(
  tables: CardTable[],
  section: CardTableSection,
  header: CardTableRow,
  rows: CardTableRow[],
): void {
  // Omit a section entirely when it has no source items (REQ-03).
  if (rows.length === 0) return;
  tables.push({ section, header, rows });
}

// REQ-03 / REQ-04 — build one table per non-empty section with fixed columns.
// `states`/`edge_cases` are widened to the v0.4.0 union at runtime; the static
// `string[]` ManifestEntry type is a narrowing of that union, so the cast hands
// the raw items to the normalizers which accept both string and object forms.
export function buildCardTablePayload(entry: ManifestEntry): CardTablePayload {
  const tables: CardTable[] = [];
  pushTable(
    tables,
    "states",
    STATE_HEADER,
    stateRows((entry.states ?? []) as StateItem[]),
  );
  pushTable(
    tables,
    "edge_cases",
    EDGE_CASE_HEADER,
    edgeCaseRows((entry.edge_cases ?? []) as EdgeCaseItem[]),
  );
  pushTable(
    tables,
    "data_requirements",
    DATA_REQUIREMENT_HEADER,
    dataRequirementRows(entry.data_requirements ?? []),
  );
  pushTable(
    tables,
    "area_annotations",
    AREA_ANNOTATION_HEADER,
    areaAnnotationRows(entry.area_annotations ?? []),
  );
  return { tables };
}
