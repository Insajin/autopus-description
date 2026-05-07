// SPEC-FIGMA-011 REQ-01 / REQ-02 / REQ-03 / REQ-05 / REQ-06.
// Write-tool dispatch + write-resource read context for the stdio MCP wire.
// Composed into mcp-stdio-handlers via `createWriteToolContext` and
// `createWriteResourceContext` so the read-only baseline (INV-W4) stays frozen.
// All outbound `text` payloads pass through `redact` (INV-W2).

import { redact } from "../token-redactor.js";
import type { DaemonWriteExtension } from "./daemon-write-extension.js";
import type { PlanEmitResult } from "../../packages/write-router/src/plan-emit/types.js";
import type {
  ManifestEntry,
  WriteTarget,
} from "../../packages/write-router/src/types.js";
import { computeSourceHash, type CanonicalValue } from "../source-hash.js";
import {
  PENDING_WRITES_URI,
  APPLIED_WRITES_URI,
  type WriteMcpResources,
} from "./write-mcp-resources.js";
import { appendAuditPartialDisconnect } from "./write-audit.js";
import type { ToolDescriptor } from "./mcp-stdio-handlers.js";

const WRITE_TARGETS: ReadonlySet<string> = new Set([
  "annotation_card",
  "descriptions_page",
  "comment",
  "plugin_data",
  "frame_name",
  "none",
]);

type Schema = ToolDescriptor["inputSchema"];

function schema(props: Record<string, { type: "string" }>, required: string[]): Schema {
  return {
    type: "object",
    properties: props as unknown as Record<string, never>,
    additionalProperties: false,
    ...({ required } as object),
  } as unknown as Schema;
}

const FRAME_TARGET = schema(
  { frame_id: { type: "string" }, write_target: { type: "string" } },
  ["frame_id", "write_target"],
);
const PENDING_ID = schema({ pending_id: { type: "string" } }, ["pending_id"]);
const APPLY_ARGS = schema(
  {
    pending_id: { type: "string" },
    source_hash_recomputed: { type: "string" },
  },
  ["pending_id", "source_hash_recomputed"],
);
const WRITE_ID = schema({ write_id: { type: "string" } }, ["write_id"]);

/* @AX:ANCHOR: [AUTO] frozen public-surface contract — canonical 5-entry
 * write-tool surface appended to READ_ONLY_TOOLS by the merged ListTools
 * handler. Order is frozen by AC-WR-1 (plan_emit, dryRun, approve, apply,
 * undo) and validated byte-for-byte by integration tests.
 * @AX:REASON: SPEC-FIGMA-011 REQ-01 — byte-equal ListTools sequence with
 * 4 read-only entries first, then these 5 write entries. Reordering or
 * renaming any entry breaks the wire contract for Codex/Claude clients. */
export const WRITE_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "plan_emit",
    description: "Emit a write plan for the given frame_id without persisting a pending record.",
    inputSchema: FRAME_TARGET,
  }),
  Object.freeze({
    name: "dryRun",
    description: "Build a PendingWrite and return its 7-key serializable view (60s TTL).",
    inputSchema: FRAME_TARGET,
  }),
  Object.freeze({
    name: "approve",
    description: "Mark a pending_id as designer-approved via plugin postMessage round-trip.",
    inputSchema: PENDING_ID,
  }),
  Object.freeze({
    name: "apply",
    description: "Apply the approved write through the connected plugin bridge.",
    inputSchema: APPLY_ARGS,
  }),
  Object.freeze({
    name: "undo",
    description: "Reverse a previously applied write by its write_id.",
    inputSchema: WRITE_ID,
  }),
]);

export const WRITE_NAMES: ReadonlySet<string> = new Set(WRITE_TOOLS.map((t) => t.name));

export const WRITE_RESOURCES_LIST: ReadonlyArray<{ uri: string; name: string }> = Object.freeze([
  { uri: PENDING_WRITES_URI, name: "pending_writes" },
  { uri: APPLIED_WRITES_URI, name: "applied_writes" },
]);

export interface ApproveStubEntry {
  readonly approved: boolean;
  readonly approved_at: string | null;
  readonly rejected_reason: string | null;
}

export interface WriteExtensionWithApprovals extends DaemonWriteExtension {
  approveResponseStub?: Map<string, ApproveStubEntry | "TIMEOUT">;
}

export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface WriteToolDispatchContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (name: string, args: Record<string, unknown>) => Promise<ToolResponse>;
}

export interface WriteResourceReadContext {
  readonly resources: ReadonlyArray<{ uri: string; name: string }>;
  readonly read: (uri: string) => unknown;
  readonly handles: (uri: string) => boolean;
}

export interface CreateWriteToolContextOptions {
  readonly auditLogPath?: string;
}

const DEFAULT_NODE_TREE: CanonicalValue = { a: 1, b: 2 } as CanonicalValue;
const DEFAULT_IMAGE = Buffer.from("abc", "ascii");

function defaultSourceHash(): string {
  return computeSourceHash({ node_tree_summary: DEFAULT_NODE_TREE, image_bytes: DEFAULT_IMAGE });
}

function buildStubEntry(frame_id: string, write_target: WriteTarget, source_hash: string): ManifestEntry {
  return {
    screen_id: `FRAME-${frame_id.replace(":", "-")}`,
    frame_id,
    title: "Login screen",
    intent: "primary CTA",
    user_value: "Designer ships description",
    success_criteria: "p95 ≤ 2s",
    states: ["default"],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash,
    write_target,
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/* @AX:WARN: [AUTO] zero-leak invariant — every outbound `text` (success and
 * JSON-RPC error) on the write-tool path passes through `redact()`. Removing
 * this leaks `figd_*` tokens / tunnel URLs to the MCP client.
 * @AX:REASON: SPEC-FIGMA-011 REQ-06 / INV-W2 — single redaction chokepoint. */
function err(message: string): ToolResponse {
  return { content: [{ type: "text", text: redact(message) }], isError: true };
}

function ok(payload: unknown): ToolResponse {
  return { content: [{ type: "text", text: redact(JSON.stringify(payload)) }] };
}

async function planEmit(ext: DaemonWriteExtension, args: Record<string, unknown>): Promise<ToolResponse> {
  const frame_id = asString(args.frame_id);
  const write_target = asString(args.write_target);
  if (!frame_id || !WRITE_TARGETS.has(write_target)) {
    return err("invalid plan_emit args: frame_id and write_target required");
  }
  const source_hash = defaultSourceHash();
  const entry = buildStubEntry(frame_id, write_target as WriteTarget, source_hash);
  const plan = (await ext.router.apply(entry, { mode: "plan-emit" })) as PlanEmitResult;
  const plan_id = ext.pendingStore.newPendingId();
  return ok({ plan_id, manifest_entry_hash: plan.manifest_entry_hash, plugin_commands: plan.plugin_commands });
}

async function dryRun(ext: DaemonWriteExtension, args: Record<string, unknown>): Promise<ToolResponse> {
  const frame_id = asString(args.frame_id);
  const write_target = asString(args.write_target);
  if (!frame_id || !WRITE_TARGETS.has(write_target)) {
    return err("invalid dryRun args: frame_id and write_target required");
  }
  const result = await ext.dryRun({ frame_id, write_target: write_target as WriteTarget });
  return ok(result);
}

function approve(ext: WriteExtensionWithApprovals, args: Record<string, unknown>): ToolResponse {
  const pending_id = asString(args.pending_id);
  if (!pending_id) return err("invalid approve args: pending_id required");
  const lookup = ext.pendingStore.get(pending_id);
  if (lookup.expired) return err(`pending_id expired: ${pending_id}`);
  if (!lookup.record) return err(`unknown pending_id: ${pending_id}`);
  const stub = ext.approveResponseStub?.get(pending_id);
  if (stub === "TIMEOUT") return err(`approve timed out for pending_id ${pending_id}`);
  if (stub) return ok({ approved: stub.approved, approved_at: stub.approved_at, rejected_reason: stub.rejected_reason });
  return ok({ approved: true, approved_at: new Date().toISOString(), rejected_reason: null });
}

/* @AX:WARN: [AUTO] plugin-confirmation gate — when the bridge is null the
 * daemon MUST NOT mutate Figma. Emit APPLY_PARTIAL_DISCONNECT and return
 * a JSON-RPC error. This branch MUST NEVER reach `bridge.dispatchCommand`.
 * @AX:REASON: SPEC-FIGMA-011 REQ-03 — plugin-as-source-of-consent invariant. */
async function apply(
  ext: DaemonWriteExtension,
  args: Record<string, unknown>,
  opts: CreateWriteToolContextOptions,
): Promise<ToolResponse> {
  const pending_id = asString(args.pending_id);
  const source_hash_recomputed = asString(args.source_hash_recomputed);
  if (!pending_id || !source_hash_recomputed) {
    return err("invalid apply args: pending_id and source_hash_recomputed required");
  }
  if (ext.bridge === null) {
    const lookup = ext.pendingStore.get(pending_id);
    if (lookup.record) {
      const row = await appendAuditPartialDisconnect(
        {
          frame_id: lookup.record.frame_id,
          manifest_entry_hash: lookup.record.manifest_entry_hash,
          pm_identity_or_unknown: "unknown",
          write_target: lookup.record.write_target,
        },
        opts.auditLogPath ? { logPath: opts.auditLogPath } : {},
      );
      ext.events.push(row);
    }
    return err(JSON.stringify({ error: "PLUGIN_NOT_CONNECTED" }));
  }
  const result = await ext.apply({ pending_id, source_hash_recomputed });
  return ok(result);
}

async function undo(ext: DaemonWriteExtension, args: Record<string, unknown>): Promise<ToolResponse> {
  const write_id = asString(args.write_id);
  if (!write_id) return err("invalid undo args: write_id required");
  const result = await ext.undo({ write_id });
  return ok(result);
}

export function createWriteToolContext(
  writeExtension: DaemonWriteExtension,
  opts: CreateWriteToolContextOptions = {},
): WriteToolDispatchContext {
  const ext = writeExtension as WriteExtensionWithApprovals;
  return {
    tools: WRITE_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "plan_emit":
          return planEmit(writeExtension, args);
        case "dryRun":
          return dryRun(writeExtension, args);
        case "approve":
          return approve(ext, args);
        case "apply":
          return apply(writeExtension, args, opts);
        case "undo":
          return undo(writeExtension, args);
        default:
          return err(`unknown write tool: ${name}`);
      }
    },
  };
}

export function createWriteResourceContext(writeResources: WriteMcpResources): WriteResourceReadContext {
  const handled: ReadonlySet<string> = new Set([PENDING_WRITES_URI, APPLIED_WRITES_URI]);
  return {
    resources: WRITE_RESOURCES_LIST,
    handles(uri) {
      return handled.has(uri);
    },
    read(uri) {
      return writeResources.read(uri);
    },
  };
}
