// SPEC-FIGMA-020 T2 — union normalizers for structured/legacy policy items
// (REQ-05, REQ-06).
//
// `states` and `edge_cases` manifest items are a string-or-object union as of
// schema v0.4.0. The table builder (card-table-payload.ts) needs a uniform
// three-column row regardless of the input form, so these pure normalizers
// coerce either shape into a fixed row. Legacy STRING input maps to the first
// column with the remaining columns empty; OBJECT input maps each field to its
// column with missing optional fields rendered as empty strings. No Figma deps.

// A normalized `state` item: state -> trigger -> result.
export interface StateRow {
  state: string;
  trigger: string;
  result: string;
}

// A normalized `edge_case` item: case -> risk -> handling.
export interface EdgeCaseRow {
  case: string;
  risk: string;
  handling: string;
}

// Structured object form of a `state` item (schema v0.4.0). `state` is the
// only required field; `trigger` and `result` are optional.
export interface StateObject {
  state: string;
  trigger?: string;
  result?: string;
}

// Structured object form of an `edge_case` item (schema v0.4.0). `case` is the
// only required field; `risk` and `handling` are optional.
export interface EdgeCaseObject {
  case: string;
  risk?: string;
  handling?: string;
}

export type StateItem = string | StateObject;
export type EdgeCaseItem = string | EdgeCaseObject;

// Trim a value to a string, treating absent/non-string input as empty.
function cell(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// REQ-06 — a legacy string maps to column 1, columns 2 and 3 stay empty.
// An object maps each field to its column; missing optionals become "".
export function normalizeState(item: StateItem): StateRow {
  if (typeof item === "string") {
    return { state: item.trim(), trigger: "", result: "" };
  }
  return {
    state: cell(item.state),
    trigger: cell(item.trigger),
    result: cell(item.result),
  };
}

// REQ-06 — same legacy-vs-structured contract for `edge_case` items.
export function normalizeEdgeCase(item: EdgeCaseItem): EdgeCaseRow {
  if (typeof item === "string") {
    return { case: item.trim(), risk: "", handling: "" };
  }
  return {
    case: cell(item.case),
    risk: cell(item.risk),
    handling: cell(item.handling),
  };
}
