// SPEC-FIGMA-017 — Vendor read-tool surface (cursor-talk-to-figma-mcp).
// Thin wrappers that forward MCP tool calls through FigmaPluginClient.
//
// Tool names mirror vendor verbatim (Strategy B in SPEC-FIGMA-017 §3.3).
// No name collisions with autopus baseline (verified Phase 1 audit).

import { redact } from "../token-redactor.js";
import type { FigmaPluginClient } from "./figma-plugin-client.js";
import type { ToolDescriptor } from "./mcp-stdio-handlers.js";
import type { ToolResponse } from "./mcp-stdio-write-handlers.js";

type Schema = ToolDescriptor["inputSchema"];

function schema(
  props: Record<string, { type: string }>,
  required: string[],
): Schema {
  return {
    type: "object",
    properties: props as unknown as Record<string, never>,
    additionalProperties: false,
    ...({ required } as object),
  } as unknown as Schema;
}

const EMPTY = schema({}, []);
const ID_ONLY = schema({ nodeId: { type: "string" } }, ["nodeId"]);
const IDS = schema({ nodeIds: { type: "array" } }, ["nodeIds"]);
const SCAN_TEXT = schema(
  {
    nodeId: { type: "string" },
    useChunking: { type: "boolean" },
    chunkSize: { type: "number" },
  },
  ["nodeId"],
);
const SCAN_TYPES = schema(
  { nodeId: { type: "string" }, types: { type: "array" } },
  ["nodeId", "types"],
);
const ANNOTATIONS_OF = schema(
  { nodeId: { type: "string" }, includeCategories: { type: "boolean" } },
  [],
);
const EXPORT_SCHEMA = schema(
  {
    nodeId: { type: "string" },
    format: { type: "string" },
    scale: { type: "number" },
  },
  ["nodeId"],
);
const INSTANCE_OVERRIDES = schema(
  {
    sourceInstanceId: { type: "string" },
    targetNodeIds: { type: "array" },
  },
  ["sourceInstanceId"],
);

export const VENDOR_READ_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({ name: "get_document_info", description: "Get detailed information about the current Figma document.", inputSchema: EMPTY }),
  Object.freeze({ name: "get_selection", description: "Get information about the current selection in Figma.", inputSchema: EMPTY }),
  Object.freeze({ name: "read_my_design", description: "Read detailed info about all top-level nodes in the current selection.", inputSchema: EMPTY }),
  Object.freeze({ name: "get_node_info", description: "Get info about a node by id.", inputSchema: ID_ONLY }),
  Object.freeze({ name: "get_nodes_info", description: "Get info about multiple nodes.", inputSchema: IDS }),
  Object.freeze({ name: "get_styles", description: "Get all local styles in the current file.", inputSchema: EMPTY }),
  Object.freeze({ name: "get_local_components", description: "Get all local components in the current file.", inputSchema: EMPTY }),
  Object.freeze({ name: "get_reactions", description: "Get prototype reactions for nodes (use first when building flow diagrams).", inputSchema: IDS }),
  Object.freeze({ name: "get_annotations", description: "Get annotations on a node or the whole document.", inputSchema: ANNOTATIONS_OF }),
  Object.freeze({ name: "get_instance_overrides", description: "Read overrides on a component instance to copy to other instances.", inputSchema: schema({ nodeId: { type: "string" } }, []) }),
  Object.freeze({ name: "scan_text_nodes", description: "Recursively scan a node for text nodes (chunked).", inputSchema: SCAN_TEXT }),
  Object.freeze({ name: "scan_nodes_by_types", description: "Scan for nodes of specific types under a parent.", inputSchema: SCAN_TYPES }),
  Object.freeze({ name: "export_node_as_image", description: "Export a node as a base64 image (PNG/JPG/SVG/PDF).", inputSchema: EXPORT_SCHEMA }),
]);

function err(message: string): ToolResponse {
  return { content: [{ type: "text", text: redact(message) }], isError: true };
}

function ok(payload: unknown): ToolResponse {
  return { content: [{ type: "text", text: redact(JSON.stringify(payload)) }] };
}

export interface VendorContextOptions {
  readonly client: FigmaPluginClient;
}

export interface VendorReadContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

async function forward(
  client: FigmaPluginClient,
  command: string,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  if (!client.isReady()) {
    return err(`PLUGIN_NOT_CONNECTED: cannot dispatch ${command}`);
  }
  try {
    const result = await client.sendCommand(command, args);
    return ok(result);
  } catch (e) {
    return err(`${command} failed: ${(e as Error).message}`);
  }
}

export function createVendorReadContext(
  opts: VendorContextOptions,
): VendorReadContext {
  const dispatch = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResponse> => {
    return forward(opts.client, name, args);
  };
  return { tools: VENDOR_READ_TOOLS, dispatch };
}
