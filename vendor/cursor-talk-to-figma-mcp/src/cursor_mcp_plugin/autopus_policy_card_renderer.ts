// Additive renderer for the SPEC-FIGMA-020 structured-table policy card.
// This module is built ON TOP of the existing area-handoff renderer: it reuses
// the placement helpers (chooseDocumentBox, boxOf) and runtime gate
// (supportsAreaHandoffRuntime) verbatim and never touches createAreaHandoffCanvas.
// The card renders REAL Figma auto-layout tables (a header row frame plus one
// row frame per item, each cell a text node) — NOT markdown pipe pseudo-tables.

import type { AreaHandoffRuntime, Box, CanvasNode } from "./autopus_area_handoff_renderer.js";
import { boxOf, supportsAreaHandoffRuntime } from "./autopus_area_handoff_renderer.js";

// LOCAL mirror of the write-router CardTablePayload wire shape. The vendor tree
// is self-contained, so this is duplicated here intentionally rather than
// imported from packages/write-router.
export interface PolicyCardTable {
  section: string;
  header: string[];
  rows: string[][];
}

export interface PolicyCardTablesArg {
  tables: PolicyCardTable[];
}

export interface PolicyCardArgs {
  frameId: string;
  tables: PolicyCardTable[];
  documentWidth?: number;
}

const WHITE = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };
const GRAY = { type: "SOLID", color: { r: 0.86, g: 0.86, b: 0.86 } };
const HEADER_FILL = { type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.96 } };
const CARD_FONT = { family: "Inter", style: "Regular" };
const HEADER_FONT = { family: "Inter", style: "Bold" };
const CELL_FONT_SIZE = 12;
const CARD_PADDING = 24;
const TABLE_GAP = 24;
const ROW_SPACING = 1;
const CELL_PADDING = 8;
const CELL_WIDTH = 200;
const CARD_WIDTH = CELL_WIDTH * 3 + CELL_PADDING * 2 + CARD_PADDING * 2;
// Gap between the source frame's right edge and the policy card.
const CARD_GAP = 80;

async function addCell(
  figma: AreaHandoffRuntime,
  row: CanvasNode,
  value: string,
  bold: boolean,
): Promise<CanvasNode> {
  const cell = figma.createText();
  cell.name = "Autopus policy cell";
  // SPEC-FIGMA-021 (live fix) — Figma rejects ANY text-property write (fontSize,
  // characters) while the node's CURRENT font is unloaded. A fresh createText()
  // node defaults to Inter Regular (unloaded), so fontName MUST be set BEFORE
  // fontSize/characters. SPEC-FIGMA-020 live fix (2026-06-10): both cell fonts are
  // preloaded ONCE in createPolicyCardCanvas (not per cell). Awaiting
  // loadFontAsync on every one of ~50+ cells serialized the render long enough to
  // cross the 30s bridge timeout, leaving partial orphan cards the compound undo
  // could not clean up.
  const cellFont = bold ? HEADER_FONT : CARD_FONT;
  cell.fontName = cellFont;
  cell.fontSize = CELL_FONT_SIZE;
  cell.characters = value;
  // SPEC-FIGMA-021 (live fix) — TextNode.width is READ-ONLY in the Figma plugin
  // API; a direct `cell.width = …` throws "no setter for property". Use resize()
  // after switching off auto-width so the column width is honored; inside the
  // HORIZONTAL auto-layout row the cell still lays out correctly. (Unit-test
  // stubs expose `width` as a plain writable prop, which is why this only
  // surfaced in the live plugin oracle.)
  const textCell = cell as CanvasNode & {
    textAutoResize?: string;
    layoutSizingHorizontal?: string;
  };
  // SPEC-FIGMA-020 live fix (2026-06-10) — make long cell text WRAP instead of
  // overflowing and clipping at the card edge. ORDER MATTERS (Figma gotcha): once
  // the cell is an auto-layout child, pin its column to a FIXED width, resize to
  // CELL_WIDTH, and set textAutoResize="HEIGHT" LAST. Setting textAutoResize before
  // the width is locked makes Figma keep WIDTH_AND_HEIGHT (single-line, auto-width),
  // which is exactly the clipping bug. (Unit-test stubs ignore the layout prop.)
  row.appendChild?.(cell);
  textCell.layoutSizingHorizontal = "FIXED";
  cell.resize?.(CELL_WIDTH, cell.fontSize ?? CELL_FONT_SIZE);
  textCell.textAutoResize = "HEIGHT";
  return cell;
}

// Builds a single auto-layout row frame whose children are text cells. Used for
// both the header row (bold) and every data row.
async function addTableRow(
  figma: AreaHandoffRuntime,
  table: CanvasNode,
  cells: string[],
  bold: boolean,
): Promise<CanvasNode[]> {
  const row = figma.createFrame();
  row.name = bold ? "Autopus policy header row" : "Autopus policy row";
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "AUTO";
  row.counterAxisSizingMode = "AUTO";
  row.itemSpacing = CELL_PADDING;
  row.paddingTop = CELL_PADDING;
  row.paddingRight = CELL_PADDING;
  row.paddingBottom = CELL_PADDING;
  row.paddingLeft = CELL_PADDING;
  row.fills = bold ? [HEADER_FILL] : [WHITE];
  table.appendChild?.(row);
  const created: CanvasNode[] = [row];
  for (const value of cells) {
    created.push(await addCell(figma, row, value, bold));
  }
  return created;
}

// Builds one auto-layout table frame (header row + one row per item) and
// appends it to the card. Returns every created node id.
async function addTable(
  figma: AreaHandoffRuntime,
  card: CanvasNode,
  spec: PolicyCardTable,
): Promise<CanvasNode[]> {
  const table = figma.createFrame();
  table.name = `Autopus policy table ${spec.section}`;
  table.layoutMode = "VERTICAL";
  table.primaryAxisSizingMode = "AUTO";
  table.counterAxisSizingMode = "AUTO";
  table.itemSpacing = ROW_SPACING;
  table.fills = [GRAY];
  card.appendChild?.(table);
  const created: CanvasNode[] = [table];
  created.push(...(await addTableRow(figma, table, spec.header, true)));
  for (const row of spec.rows) {
    created.push(...(await addTableRow(figma, table, row, false)));
  }
  return created;
}

// Renders a policy card next to the source frame: one auto-layout table per
// section, positioned by the shared placement helper. Gated by the same runtime
// support check as createAreaHandoffCanvas.
export async function createPolicyCardCanvas(
  figma: AreaHandoffRuntime,
  args: PolicyCardArgs,
): Promise<{ id: string; node_ids: string[] }> {
  if (!supportsAreaHandoffRuntime(figma)) {
    throw new Error("policy card runtime not supported");
  }
  // SPEC-FIGMA-020 live fix (2026-06-10) — preload both cell fonts ONCE here so
  // addCell never awaits per cell. loadFontAsync is idempotent/cached, so the two
  // awaits cost one fetch each up front instead of serializing 50+ awaits during
  // the row loop (which previously pushed the render past the 30s bridge timeout).
  if (figma.loadFontAsync) {
    await figma.loadFontAsync(CARD_FONT);
    await figma.loadFontAsync(HEADER_FONT);
  }
  const source = await figma.getNodeByIdAsync(args.frameId);
  if (!source) throw new Error(`source frame not found: ${args.frameId}`);
  const sourceBox: Box = boxOf(source);
  const width = Number(args.documentWidth ?? CARD_WIDTH);
  const height = Math.max(200, CARD_PADDING * 2 + args.tables.length * 120);
  // SPEC-FIGMA-020 live fix (2026-06-11) — place the card immediately to the RIGHT
  // of the source frame so it sits in the same viewport. The previous
  // chooseDocumentBox collision-avoidance dumped the card far off-canvas
  // (maxRight+gap) on dense boards, making it effectively invisible. Adjacent
  // placement may briefly overlap legacy cards; that is acceptable (legacy is
  // removed after migration) and keeps the card findable next to its frame.
  const cardBox: Box = {
    x: sourceBox.x + sourceBox.width + CARD_GAP,
    y: sourceBox.y,
    width,
    height,
  };
  const card = figma.createFrame();
  card.name = "Autopus Policy Card";
  card.x = cardBox.x;
  card.y = cardBox.y;
  card.fills = [WHITE];
  card.strokes = [GRAY];
  card.strokeWeight = 1;
  card.layoutMode = "VERTICAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "AUTO";
  card.itemSpacing = TABLE_GAP;
  card.paddingTop = CARD_PADDING;
  card.paddingRight = CARD_PADDING;
  card.paddingBottom = CARD_PADDING;
  card.paddingLeft = CARD_PADDING;
  figma.currentPage.appendChild(card);
  const nodeIds = [card.id];
  for (const table of args.tables) {
    for (const node of await addTable(figma, card, table)) nodeIds.push(node.id);
  }
  return { id: card.id, node_ids: nodeIds };
}
