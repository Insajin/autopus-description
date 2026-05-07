// SPEC-FIGMA-009 REQ-03 / REQ-04 / REQ-06.
// Resource and tool request handlers for the stdio MCP wire transport.
// All outbound `text` payloads pass through `redact` (INV-W2).
// `READ_ONLY_TOOLS` is the canonical 4-entry tool surface (INV-W4); write
// tools from SPEC-FIGMA-007 (`plan_emit`/`dry_run`/`approve`/`apply`/`undo`)
// MUST NOT appear here.

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
}

export function registerResourceHandlers(
  server: Server,
  wiring: HandlerWiring,
): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const items = await wiring.mcp.list();
    return {
      resources: items.map((r) => ({ uri: r.uri, name: r.name })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const data = await wiring.mcp.read(uri);
    /* @AX:WARN: [AUTO] zero-leak invariant — every outbound `text` payload on
     * the ReadResource path MUST pass through `redact()`. Removing or
     * bypassing this call leaks tunnel URLs / secrets to the MCP client.
     * @AX:REASON: SPEC-FIGMA-009 INV-W2 — redaction is the sole boundary
     * between daemon-internal JSON and the wire transport. */
    const text = redact(JSON.stringify(data));
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text,
        },
      ],
    };
  });
}

export function registerToolHandlers(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: READ_ONLY_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: {
        type: t.inputSchema.type,
        properties: { ...t.inputSchema.properties },
        additionalProperties: t.inputSchema.additionalProperties,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    if (!READ_ONLY_NAMES.has(name)) {
      return {
        content: [{ type: "text", text: redact("unknown tool") }],
        isError: true,
      };
    }
    const result = await handleMcpToolCall({ tool: name, args });
    /* @AX:WARN: [AUTO] zero-leak invariant — CallTool outbound `text` MUST be
     * redacted before reaching the transport. Direct return of
     * `result.constructed_prompt` would leak any tunnel URL embedded by upstream
     * tool builders.
     * @AX:REASON: SPEC-FIGMA-009 INV-W2 — single redaction chokepoint on the
     * tool-call response path. */
    const text = redact(result.constructed_prompt);
    return {
      content: [{ type: "text", text }],
    };
  });
}
