// SPEC-FIGMA-004 WriteRouter internals — option contracts and id/timestamp
// helpers extracted from index.ts to keep that file under the 300-line limit.
// Pure structural split: these symbols are internal to the package's apply
// path and are NOT part of the public barrel surface re-exported from index.ts.
import type { Adapter, UndoDescriptor, WriteTarget } from "./types.js";
import type { AdapterRegistry } from "./registry.js";
import type { PlanEmitContext } from "./plan-emit/types.js";

export interface WriteRouterApplyOptions {
  mode?: "executor" | "plan-emit"; planContext?: PlanEmitContext;
}

export interface WriteRouterOptions {
  registry?: AdapterRegistry;
  adapters?: Partial<Record<WriteTarget, Adapter>>;
  auditLogPath?: string;
  figma?: unknown;
  figmaToken?: string;
  slackToken?: string;
  valid?: boolean;
  pmIdentity?: string;
  // SPEC-FIGMA-019 — optional capture-time scrub of the restore-annotation
  // prior. When omitted the seam is identity (REQ-06): existing callers, and
  // consumers like the daemon that redact at their own boundary, are unaffected.
  redactRestoreDescriptor?: (d: UndoDescriptor) => UndoDescriptor;
}

let writeIdCounter = 0;
export function nextWriteId(): string {
  writeIdCounter += 1;
  return `wr-${Date.now().toString(36)}-${writeIdCounter}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
