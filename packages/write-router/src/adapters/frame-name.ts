// SPEC-FIGMA-004 W2 — frame_name adapter (REQ-05, REQ-08, INV-002, INV-005).
//
// X4 mitigation: frame name writes pollute the Figma canvas globally and
// cannot be selectively undone by viewers. The opt-in gate is the SAFETY
// boundary. Default-disabled. Bypassing the gate is forbidden.
//
// Enable via either:
//   - env: ALLOW_FRAME_NAME=1
//   - flag: process.argv contains "--allow-frame-name"
// When disabled, apply throws FRAME_NAME_OPT_IN_REQUIRED with ZERO Figma
// calls. When enabled, apply mutates the frame name to
// `${original_name} · ${screen_id}` and emits a warning whose literal
// substring is asserted by AC-S6.

import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
} from "../types.js";
import { ERROR_CODES, WriteRouterError } from "../types.js";

export const FRAME_NAME_WARNING =
  "frame_name write applied (X4 canvas pollution risk)";
export const FRAME_NAME_OPT_IN_FLAG = "--allow-frame-name";
export const FRAME_NAME_OPT_IN_ENV = "ALLOW_FRAME_NAME";

interface FrameNameClient {
  getFrameName(nodeId: string): Promise<string> | string;
  setFrameName(nodeId: string, name: string): Promise<void> | void;
}

export interface FrameNameOptInProvider {
  isAllowed(): boolean;
}

const defaultOptInProvider: FrameNameOptInProvider = {
  isAllowed(): boolean {
    if (process.env[FRAME_NAME_OPT_IN_ENV] === "1") return true;
    if (Array.isArray(process.argv) && process.argv.includes(FRAME_NAME_OPT_IN_FLAG)) {
      return true;
    }
    return false;
  },
};

let activeProvider: FrameNameOptInProvider = defaultOptInProvider;

export function setFrameNameOptInProvider(provider: FrameNameOptInProvider | null): void {
  activeProvider = provider ?? defaultOptInProvider;
}

function asClient(figma: unknown): FrameNameClient {
  if (!figma || typeof figma !== "object") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "frame_name adapter requires a Figma write client",
    );
  }
  const candidate = figma as Partial<FrameNameClient>;
  if (
    typeof candidate.getFrameName !== "function" ||
    typeof candidate.setFrameName !== "function"
  ) {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      "frame_name client missing required methods",
    );
  }
  return candidate as FrameNameClient;
}

function emitWarning(ctx: AdapterContext): void {
  if (typeof ctx.warn === "function") {
    ctx.warn(FRAME_NAME_WARNING);
    return;
  }
  console.warn(FRAME_NAME_WARNING);
}

export async function applyFrameName(
  entry: ManifestEntry,
  ctx: AdapterContext,
): Promise<AdapterApplyResult> {
  if (!activeProvider.isAllowed()) {
    throw new WriteRouterError(
      ERROR_CODES.FRAME_NAME_OPT_IN_REQUIRED,
      "frame_name opt-in required",
    );
  }
  const client = asClient(ctx.figma);
  const original_name = await client.getFrameName(entry.frame_id);
  const newName = `${original_name} · ${entry.screen_id}`;
  await client.setFrameName(entry.frame_id, newName);
  emitWarning(ctx);
  const undo_descriptor: UndoDescriptor = {
    type: "restore-frame-name",
    node_id: entry.frame_id,
    original_name,
  };
  return { undo_descriptor, node_id: entry.frame_id, fallback_used: false };
}

export async function undoFrameName(
  descriptor: UndoDescriptor,
  ctx: AdapterContext,
): Promise<void> {
  if (descriptor.type !== "restore-frame-name") {
    throw new WriteRouterError(
      ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
      `frame_name undo expected restore-frame-name, got ${descriptor.type}`,
    );
  }
  const client = asClient(ctx.figma);
  await client.setFrameName(descriptor.node_id, descriptor.original_name);
}

export const frameNameAdapter: Adapter = {
  apply: applyFrameName,
  undo: undoFrameName,
};
