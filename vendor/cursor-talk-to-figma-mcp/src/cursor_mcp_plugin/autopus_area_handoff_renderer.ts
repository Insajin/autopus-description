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
  parent?: CanvasNode | null;
  children?: CanvasNode[];
  visible?: boolean;
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
  currentPage: { children?: CanvasNode[]; appendChild(node: CanvasNode): void };
  getNodeByIdAsync(id: string): Promise<CanvasNode | null>;
  createFrame(): CanvasNode;
  createText(): CanvasNode;
  createEllipse(): CanvasNode;
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
const WHITE = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };
const GRAY = { type: "SOLID", color: { r: 0.86, g: 0.86, b: 0.86 } };
const PLACEMENT_GAP = 96;
const COLLISION_MARGIN = 24;

function boxOf(node: CanvasNode): Box {
  return node.absoluteBoundingBox ?? {
    x: node.x,
    y: node.y,
    width: node.width ?? 800,
    height: node.height ?? 600,
  };
}

function overlaps(a: Box, b: Box, margin = COLLISION_MARGIN): boolean {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

function isAncestor(candidate: CanvasNode, node: CanvasNode): boolean {
  let cursor = node.parent;
  while (cursor) {
    if (cursor.id === candidate.id) return true;
    cursor = cursor.parent;
  }
  return false;
}

function pushUnique(nodes: CanvasNode[], seen: Set<string>, node: CanvasNode): void {
  if (seen.has(node.id)) return;
  seen.add(node.id);
  nodes.push(node);
}

function collisionNodes(figma: AreaHandoffRuntime, source: CanvasNode): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const seen = new Set<string>();
  for (const node of source.parent?.children ?? []) pushUnique(nodes, seen, node);
  for (const node of figma.currentPage.children ?? []) pushUnique(nodes, seen, node);
  return nodes.filter((node) => {
    if (node.id === source.id || node.visible === false || isAncestor(node, source)) return false;
    const box = node.absoluteBoundingBox ?? (node.width && node.height ? boxOf(node) : null);
    return !!box;
  });
}

function candidateBoxes(sourceBox: Box, width: number, height: number): Box[] {
  return [
    { x: sourceBox.x + sourceBox.width + PLACEMENT_GAP, y: sourceBox.y, width, height },
    { x: sourceBox.x, y: sourceBox.y + sourceBox.height + PLACEMENT_GAP, width, height },
    { x: sourceBox.x - width - PLACEMENT_GAP, y: sourceBox.y, width, height },
    { x: sourceBox.x, y: sourceBox.y - height - PLACEMENT_GAP, width, height },
  ];
}

function chooseDocumentBox(
  figma: AreaHandoffRuntime,
  source: CanvasNode,
  sourceBox: Box,
  width: number,
  height: number,
): Box {
  const blockers = collisionNodes(figma, source).map(boxOf);
  for (const candidate of candidateBoxes(sourceBox, width, height)) {
    if (!blockers.some((blocker) => overlaps(candidate, blocker))) return candidate;
  }
  const maxRight = blockers.reduce(
    (right, box) => Math.max(right, box.x + box.width),
    sourceBox.x + sourceBox.width,
  );
  return { x: maxRight + PLACEMENT_GAP, y: sourceBox.y, width, height };
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

async function addDocumentBadge(
  figma: AreaHandoffRuntime,
  parent: CanvasNode,
  label: string,
  y: number,
): Promise<CanvasNode[]> {
  const badge = figma.createEllipse();
  badge.name = `Autopus document badge ${label}`;
  badge.x = 24;
  badge.y = y;
  badge.fills = [RED];
  badge.resize?.(28, 28);
  parent.appendChild?.(badge);
  const text = figma.createText();
  text.name = `Autopus document badge label ${label}`;
  text.x = label.length > 1 ? 29 : 32;
  text.y = y + 6;
  text.fontSize = label.length > 1 ? 9 : 11;
  text.fills = [WHITE];
  if (figma.loadFontAsync) await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  text.characters = label;
  parent.appendChild?.(text);
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
  const height = Math.max(340, 168 + args.areaCallouts.length * 104);
  const docBox = chooseDocumentBox(figma, source, sourceBox, width, height);
  const doc = figma.createFrame();
  doc.name = "Autopus Area Handoff";
  doc.x = docBox.x;
  doc.y = docBox.y;
  doc.fills = [WHITE];
  doc.strokes = [GRAY];
  doc.strokeWeight = 1;
  doc.resize?.(width, height);
  figma.currentPage.appendChild(doc);
  const nodeIds = [doc.id];
  nodeIds.push((await addText(figma, doc, args.text, 68, 24, 13)).id);
  for (const [index, area] of args.areaCallouts.entries()) {
    const y = sourceBox.y + 40 + index * 48;
    const [badge, badgeText] = await addBadge(figma, area.badgeLabel, sourceBox.x + 16, y);
    const [docBadge, docBadgeText] = await addDocumentBadge(
      figma,
      doc,
      area.badgeLabel,
      88 + index * 104,
    );
    nodeIds.push(badge.id, badgeText.id, docBadge.id, docBadgeText.id);
  }
  return { id: doc.id, node_ids: nodeIds };
}

export function supportsAreaHandoffRuntime(value: unknown): value is AreaHandoffRuntime {
  const v = value as Partial<AreaHandoffRuntime> | null;
  return !!v && typeof v.getNodeByIdAsync === "function" && typeof v.createFrame === "function";
}
