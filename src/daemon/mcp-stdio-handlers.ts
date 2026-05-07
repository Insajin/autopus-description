// SPEC-FIGMA-009 REQ-03 / REQ-04 / REQ-06 + SPEC-FIGMA-011 REQ-01 / REQ-05.
// Resource and tool request handlers for the stdio MCP wire transport.
// All outbound `text` payloads pass through `redact` (INV-W2).
// `READ_ONLY_TOOLS` is the canonical 4-entry read-only baseline (INV-W4).
// Write tools/resources are merged in via the optional contexts on
// `HandlerWiring`; ListTools concatenates read-first, write-second.

import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { redact } from "../token-redactor.js";
import type { McpResources } from "./mcp-resources.js";
import { handleMcpToolCall } from "./mcp-tools.js";
import type {
  WriteToolDispatchContext,
  WriteResourceReadContext,
} from "./mcp-stdio-write-handlers.js";

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, never>;
    readonly additionalProperties: false;
  };
}

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object" as const,
  properties: Object.freeze({}) as Record<string, never>,
  additionalProperties: false as const,
});

/* @AX:ANCHOR: [AUTO] fan-in=6 — canonical 4-entry read-only tool surface
 * referenced by stdio handlers, tool-surface tests, coverage tests, and the
 * write-tool exclusion guard. Adding write tools here violates INV-W4.
 * @AX:REASON: SPEC-FIGMA-009 INV-W4 — read-only invariant of the wire surface;
 * SPEC-FIGMA-007 write tools (plan_emit/dry_run/approve/apply/undo) MUST stay
 * out of this list. */
export const READ_ONLY_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "get_active_selection",
    description: "Returns the most-recently-published frame description.",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
  Object.freeze({
    name: "get_pending_descriptions",
    description: "Returns up to 30 most-recent publishes (bounded queue).",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
  Object.freeze({
    name: "get_audit_events",
    description: "Returns the recent audit-row mirror (read-only).",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
  Object.freeze({
    name: "get_stale_frames",
    description:
      "Returns frames whose current source_hash differs from last published.",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
]);

const READ_ONLY_NAMES: ReadonlySet<string> = new Set(
  READ_ONLY_TOOLS.map((t) => t.name),
);

export interface HandlerWiring {
  readonly mcp: McpResources;
  readonly writeToolContext?: WriteToolDispatchContext;
  readonly writeResourceContext?: WriteResourceReadContext;
}

function toToolWire(t: ToolDescriptor): {
  name: string;
  description: string;
  inputSchema: object;
} {
  return {
    name: t.name,
    description: t.description,
    inputSchema: {
      type: t.inputSchema.type,
      properties: { ...t.inputSchema.properties },
      additionalProperties: t.inputSchema.additionalProperties,
      ...((t.inputSchema as unknown as { required?: readonly string[] }).required
        ? {
            required: [
              ...((t.inputSchema as unknown as { required: readonly string[] })
                .required),
            ],
          }
        : {}),
    },
  };
}

export function registerResourceHandlers(
  server: Server,
  wiring: HandlerWiring,
): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const items = await wiring.mcp.list();
    const base = items.map((r) => ({ uri: r.uri, name: r.name }));
    const writes = wiring.writeResourceContext
      ? wiring.writeResourceContext.resources.map((r) => ({
          uri: r.uri,
          name: r.name,
        }))
      : [];
    return { resources: [...base, ...writes] };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const data =
      wiring.writeResourceContext && wiring.writeResourceContext.handles(uri)
        ? wiring.writeResourceContext.read(uri)
        : await wiring.mcp.read(uri);
    /* @AX:WARN: [AUTO] zero-leak invariant — every outbound `text` payload on
     * the ReadResource path MUST pass through `redact()`. Removing or
     * bypassing this call leaks tunnel URLs / secrets to the MCP client.
     * @AX:REASON: SPEC-FIGMA-009 INV-W2 — redaction is the sole boundary
     * between daemon-internal JSON and the wire transport. */
    const text = redact(JSON.stringify(data));
    return {
      contents: [{ uri, mimeType: "application/json", text }],
    };
  });
}

export function registerToolHandlers(
  server: Server,
  wiring?: Pick<HandlerWiring, "writeToolContext">,
): void {
  const writeCtx = wiring?.writeToolContext;
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const reads = READ_ONLY_TOOLS.map(toToolWire);
    const writes = writeCtx ? writeCtx.tools.map(toToolWire) : [];
    return { tools: [...reads, ...writes] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    if (READ_ONLY_NAMES.has(name)) {
      const result = await handleMcpToolCall({ tool: name, args });
      /* @AX:WARN: [AUTO] zero-leak invariant — CallTool outbound `text` MUST be
       * redacted before reaching the transport.
       * @AX:REASON: SPEC-FIGMA-009 INV-W2 — single redaction chokepoint on the
       * read tool-call response path. */
      return { content: [{ type: "text", text: redact(result.constructed_prompt) }] };
    }
    if (writeCtx) {
      const r = await writeCtx.dispatch(name, args);
      return r as unknown as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
    }
    return {
      content: [{ type: "text", text: redact("unknown tool") }],
      isError: true,
    };
  });
}
