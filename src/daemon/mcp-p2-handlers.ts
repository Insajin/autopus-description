// SPEC-FIGMA-016 — P2 operational MCP surface (dispatchers).
// Read tools: get_batch_status, get_generation_mode, preview_description,
//             get_daemon_status (4 entries)
// Write tools: submit_batch_lane, force_generation_mode (2 entries)
//
// State primitives (BatchStore, ModeOverride, redactTunnelUrl, DaemonStatusSource)
// live in `mcp-p2-state.ts`. This file only owns ToolDescriptor wiring and
// dispatch, keeping it under the 300-line file limit.

import { redact } from "../token-redactor.js";
import {
  redactTunnelUrl,
  type BatchStore,
  type DaemonStatusSource,
  type ModeOverride,
} from "./mcp-p2-state.js";
import type { ToolDescriptor } from "./mcp-stdio-handlers.js";
import type { ToolResponse } from "./mcp-stdio-write-handlers.js";

type Schema = ToolDescriptor["inputSchema"];

function schema(
  props: Record<string, { type: "string" | "number" | "boolean" | "array" }>,
  required: string[],
): Schema {
  return {
    type: "object",
    properties: props as unknown as Record<string, never>,
    additionalProperties: false,
    ...({ required } as object),
  } as unknown as Schema;
}

const BATCH_SUBMIT_SCHEMA = schema(
  {
    file_id: { type: "string" },
    node_ids: { type: "array" },
    provider: { type: "string" },
    model: { type: "string" },
  },
  ["file_id", "node_ids"],
);
const BATCH_STATUS_SCHEMA = schema({ batch_id: { type: "string" } }, [
  "batch_id",
]);
const MODE_SCHEMA = schema(
  { mode: { type: "string" }, clear: { type: "boolean" } },
  [],
);
const EMPTY_SCHEMA = schema({}, []);
const PREVIEW_SCHEMA = schema({ pending_id: { type: "string" } }, [
  "pending_id",
]);

export const P2_READ_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "get_batch_status",
    description:
      "Return state of a previously-submitted batch job (in_progress/completed/failed).",
    inputSchema: BATCH_STATUS_SCHEMA,
  }),
  Object.freeze({
    name: "get_generation_mode",
    description:
      "Return the active generation mode (auto/node-only/vision-only) and override status.",
    inputSchema: EMPTY_SCHEMA,
  }),
  Object.freeze({
    name: "preview_description",
    description:
      "Render a human-readable markdown preview of a pending description.",
    inputSchema: PREVIEW_SCHEMA,
  }),
  Object.freeze({
    name: "get_daemon_status",
    description:
      "Return redacted operational state: version, uptime, transport, tunnel, queue sizes.",
    inputSchema: EMPTY_SCHEMA,
  }),
]);

export const P2_WRITE_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "submit_batch_lane",
    description:
      "Submit multi-frame description generation to the Anthropic Message Batches lane (24h SLA, 50% cost).",
    inputSchema: BATCH_SUBMIT_SCHEMA,
  }),
  Object.freeze({
    name: "force_generation_mode",
    description:
      "Override generation mode (auto/node-only/vision-only) for subsequent generate_description calls.",
    inputSchema: MODE_SCHEMA,
  }),
]);

function err(message: string): ToolResponse {
  return { content: [{ type: "text", text: redact(message) }], isError: true };
}

function ok(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: redact(JSON.stringify(payload)) }],
  };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export interface P2ContextOptions {
  readonly batchStore: BatchStore;
  readonly modeOverride: ModeOverride;
  readonly statusSource: DaemonStatusSource;
  readonly previewFromPending: (
    pendingId: string,
  ) => Promise<{
    pending_id: string;
    intent: string;
    user_value: string;
    success_criteria: string;
    states: string[];
    edge_cases: string[];
  } | null>;
}

export interface P2ReadContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

export interface P2WriteContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

function getBatchStatus(
  opts: P2ContextOptions,
  args: Record<string, unknown>,
): ToolResponse {
  const batch_id = asString(args.batch_id);
  if (!batch_id) return err("get_batch_status requires batch_id");
  const handle = opts.batchStore.get(batch_id);
  if (!handle) {
    return ok({ batch_id, state: "failed", error: "UNKNOWN_BATCH" });
  }
  return ok(handle);
}

function getMode(opts: P2ContextOptions): ToolResponse {
  return ok(opts.modeOverride.get());
}

async function preview(
  opts: P2ContextOptions,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const pending_id = asString(args.pending_id);
  if (!pending_id) return err("preview_description requires pending_id");
  const entry = await opts.previewFromPending(pending_id);
  if (!entry) return ok({ error: "PENDING_NOT_FOUND", pending_id });
  const markdown = [
    `# Pending ${pending_id}`,
    "",
    `**Intent**: ${entry.intent}`,
    `**User value**: ${entry.user_value}`,
    `**Success criteria**: ${entry.success_criteria}`,
    "",
    "## States",
    ...entry.states.map((s) => `- ${s}`),
    "",
    "## Edge cases",
    ...entry.edge_cases.map((e) => `- ${e}`),
  ].join("\n");
  return ok({ ...entry, markdown });
}

function getDaemonStatus(opts: P2ContextOptions): ToolResponse {
  const src = opts.statusSource;
  const uptime_seconds = Math.floor(
    (Date.now() - src.startedAt.getTime()) / 1000,
  );
  return ok({
    version: src.version,
    uptime_seconds,
    transport: src.transport,
    tunnel: {
      attached: src.tunnelUrl !== null,
      redacted_url: redactTunnelUrl(src.tunnelUrl),
    },
    pending_count: src.pendingCount(),
    applied_count: src.appliedCount(),
    audit_row_count: src.auditRowCount(),
    last_initialize_at: src.lastInitializeAt(),
  });
}

function submitBatch(
  opts: P2ContextOptions,
  args: Record<string, unknown>,
): ToolResponse {
  const file_id = asString(args.file_id);
  const node_ids = asArray(args.node_ids);
  if (!file_id || node_ids.length === 0) {
    return err("submit_batch_lane requires file_id and node_ids[]");
  }
  if (node_ids.length < 2) {
    return err(
      "submit_batch_lane requires node_ids.length >= 2; use generate_description for single-frame",
    );
  }
  const handle = opts.batchStore.submit({ file_id, node_ids });
  return ok(handle);
}

function forceMode(
  opts: P2ContextOptions,
  args: Record<string, unknown>,
): ToolResponse {
  if (args.clear === true) {
    const cleared = opts.modeOverride.clear();
    return ok({ ...cleared, cleared: true });
  }
  const mode = asString(args.mode);
  if (mode !== "auto" && mode !== "node-only" && mode !== "vision-only") {
    return err(
      "force_generation_mode: mode must be auto|node-only|vision-only or pass clear:true",
    );
  }
  const next = opts.modeOverride.set(mode);
  return ok({ ...next, cleared: false });
}

export function createP2ReadContext(opts: P2ContextOptions): P2ReadContext {
  return {
    tools: P2_READ_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "get_batch_status":
          return getBatchStatus(opts, args);
        case "get_generation_mode":
          return getMode(opts);
        case "preview_description":
          return preview(opts, args);
        case "get_daemon_status":
          return getDaemonStatus(opts);
        default:
          return err(`unknown p2 read tool: ${name}`);
      }
    },
  };
}

export function createP2WriteContext(opts: P2ContextOptions): P2WriteContext {
  return {
    tools: P2_WRITE_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "submit_batch_lane":
          return submitBatch(opts, args);
        case "force_generation_mode":
          return forceMode(opts, args);
        default:
          return err(`unknown p2 write tool: ${name}`);
      }
    },
  };
}
