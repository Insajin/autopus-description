import type { AreaHandoffCallout } from "./autopus_command_dispatch.js";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasNode {
  id: string;
  name: string;
  x: number;
  y: number;
  fills?: unknown[];
  strokes?: unknown[];
  strokeWeight?: number;
  characters?: string;
  fontSize?: number;
  appendChild?: (node: CanvasNode) => void;
  resize?: (width: number, height: number) => void;
  absoluteBoundingBox?: Box;
  width?: number;
  height?: number;
}

export interface AreaHandoffRuntime {
  currentPage: { appendChild(node: CanvasNode): void };
  getNodeByIdAsync(id: string): Promise<CanvasNode | null>;
  createFrame(): CanvasNode;
  createText(): CanvasNode;
  createEllipse(): CanvasNode;
  createLine(): CanvasNode;
  loadFontAsync?(font: { family: string; style: string }): Promise<void>;
}

export interface AreaHandoffArgs {
  frameId: string;
  text: string;
  areaCallouts: AreaHandoffCallout[];
  documentPosition?: string;
  visualPolicy?: Record<string, unknown>;
}

const RED = { type: "SOLID", color: { r: 1, g: 0.231, b: 0.188 } };
const MAGENTA = { type: "SOLID", color: { r: 1, g: 0.169, b: 0.839 } };
const WHITE = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };
const GRAY = { type: "SOLID", color: { r: 0.86, g: 0.86, b: 0.86 } };

function boxOf(node: CanvasNode): Box {
  return node.absoluteBoundingBox ?? {
    x: node.x,
    y: node.y,
    width: node.width ?? 800,
    height: node.height ?? 600,
  };
}

async function addText(
  figma: AreaHandoffRuntime,
  parent: CanvasNode,
  text: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<CanvasNode> {
  const node = figma.createText();
  node.name = "Autopus handoff text";
  node.x = x;
  node.y = y;
  node.fontSize = fontSize;
  if (figma.loadFontAsync) await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  node.characters = text;
  parent.appendChild?.(node);
  return node;
}

function addLine(figma: AreaHandoffRuntime, x1: number, y1: number, x2: number, y2: number): CanvasNode {
  const line = figma.createLine();
  line.name = "Autopus callout connector";
  line.x = x1;
  line.y = y1;
  line.strokes = [MAGENTA];
  line.strokeWeight = 2;
  line.resize?.(Math.max(1, x2 - x1), Math.max(1, y2 - y1));
  figma.currentPage.appendChild(line);
  return line;
}

async function addBadge(
  figma: AreaHandoffRuntime,
  label: string,
  x: number,
  y: number,
): Promise<CanvasNode[]> {
  const badge = figma.createEllipse();
  badge.name = `Autopus callout badge ${label}`;
  badge.x = x;
  badge.y = y;
  badge.fills = [RED];
  badge.resize?.(28, 28);
  figma.currentPage.appendChild(badge);
  const text = figma.createText();
  text.name = `Autopus callout badge label ${label}`;
  text.x = x + 8;
  text.y = y + 6;
  text.fontSize = 11;
  text.fills = [WHITE];
  if (figma.loadFontAsync) await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  text.characters = label;
  figma.currentPage.appendChild(text);
  return [badge, text];
}

export async function createAreaHandoffCanvas(
  figma: AreaHandoffRuntime,
  args: AreaHandoffArgs,
): Promise<{ id: string; node_ids: string[] }> {
  const source = await figma.getNodeByIdAsync(args.frameId);
  if (!source) throw new Error(`source frame not found: ${args.frameId}`);
  const sourceBox = boxOf(source);
  const width = Number(args.visualPolicy?.documentWidth ?? 720);
  const height = Math.max(300, 150 + args.areaCallouts.length * 104);
  const doc = figma.createFrame();
  doc.name = "Autopus Area Handoff";
  doc.x = sourceBox.x + sourceBox.width + 96;
  doc.y = sourceBox.y;
  doc.fills = [WHITE];
  doc.strokes = [GRAY];
  doc.strokeWeight = 1;
  doc.resize?.(width, height);
  figma.currentPage.appendChild(doc);
  const nodeIds = [doc.id];
  nodeIds.push((await addText(figma, doc, args.text, 24, 24, 13)).id);
  for (const [index, area] of args.areaCallouts.entries()) {
    const y = sourceBox.y + 40 + index * 48;
    const [badge, badgeText] = await addBadge(figma, area.badgeLabel, sourceBox.x + 16, y);
    const line = addLine(figma, sourceBox.x + 44, y + 14, doc.x, doc.y + 88 + index * 104);
    nodeIds.push(badge.id, badgeText.id, line.id);
  }
  return { id: doc.id, node_ids: nodeIds };
}

export function supportsAreaHandoffRuntime(value: unknown): value is AreaHandoffRuntime {
  const v = value as Partial<AreaHandoffRuntime> | null;
  return !!v && typeof v.getNodeByIdAsync === "function" && typeof v.createFrame === "function";
}
