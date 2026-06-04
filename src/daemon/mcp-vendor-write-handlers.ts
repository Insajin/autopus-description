// SPEC-FIGMA-017 — Vendor write-tool surface (cursor-talk-to-figma-mcp).
// Thin wrappers forwarding through FigmaPluginClient. Names match vendor.

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

const CREATE_RECT = schema(
  {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    name: { type: "string" },
    parentId: { type: "string" },
  },
  ["x", "y", "width", "height"],
);
const CREATE_FRAME = schema(
  {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    name: { type: "string" },
    parentId: { type: "string" },
    fillColor: { type: "object" },
    layoutMode: { type: "string" },
  },
  ["x", "y", "width", "height"],
);
const CREATE_TEXT = schema(
  {
    x: { type: "number" },
    y: { type: "number" },
    text: { type: "string" },
    fontSize: { type: "number" },
    fontWeight: { type: "number" },
    fontColor: { type: "object" },
    name: { type: "string" },
    parentId: { type: "string" },
  },
  ["x", "y", "text"],
);
const FILL_COLOR = schema(
  { nodeId: { type: "string" }, r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } },
  ["nodeId", "r", "g", "b"],
);
const STROKE_COLOR = schema(
  { nodeId: { type: "string" }, r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" }, weight: { type: "number" } },
  ["nodeId", "r", "g", "b"],
);
const MOVE_NODE = schema(
  { nodeId: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
  ["nodeId", "x", "y"],
);
const RESIZE_NODE = schema(
  { nodeId: { type: "string" }, width: { type: "number" }, height: { type: "number" } },
  ["nodeId", "width", "height"],
);
const CORNER = schema(
  { nodeId: { type: "string" }, radius: { type: "number" }, corners: { type: "array" } },
  ["nodeId", "radius"],
);
const SET_TEXT = schema({ nodeId: { type: "string" }, text: { type: "string" } }, ["nodeId", "text"]);
const MULTI_TEXT = schema(
  { nodeId: { type: "string" }, text: { type: "array" } },
  ["nodeId", "text"],
);
const LAYOUT_MODE = schema(
  { nodeId: { type: "string" }, layoutMode: { type: "string" }, layoutWrap: { type: "string" } },
  ["nodeId", "layoutMode"],
);
const PADDING = schema(
  { nodeId: { type: "string" }, paddingTop: { type: "number" }, paddingRight: { type: "number" }, paddingBottom: { type: "number" }, paddingLeft: { type: "number" } },
  ["nodeId"],
);
const AXIS_ALIGN = schema(
  { nodeId: { type: "string" }, primaryAxisAlignItems: { type: "string" }, counterAxisAlignItems: { type: "string" } },
  ["nodeId"],
);
const LAYOUT_SIZING = schema(
  { nodeId: { type: "string" }, layoutSizingHorizontal: { type: "string" }, layoutSizingVertical: { type: "string" } },
  ["nodeId"],
);
const ITEM_SPACING = schema(
  { nodeId: { type: "string" }, itemSpacing: { type: "number" }, counterAxisSpacing: { type: "number" } },
  ["nodeId", "itemSpacing"],
);
const ANNOTATION = schema(
  { nodeId: { type: "string" }, annotationId: { type: "string" }, labelMarkdown: { type: "string" }, categoryId: { type: "string" }, properties: { type: "array" } },
  ["nodeId", "labelMarkdown"],
);
const MULTI_ANNOTATION = schema(
  { nodeId: { type: "string" }, annotations: { type: "array" } },
  ["nodeId", "annotations"],
);
const COMPONENT_INSTANCE = schema(
  { componentKey: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
  ["componentKey", "x", "y"],
);
const SET_INSTANCE_OVERRIDES = schema(
  { sourceInstanceId: { type: "string" }, targetNodeIds: { type: "array" } },
  ["sourceInstanceId", "targetNodeIds"],
);
const SWAP_OVERRIDES = schema(
  { sourceInstanceId: { type: "string" }, targetInstanceId: { type: "string" } },
  ["sourceInstanceId", "targetInstanceId"],
);
// `confirm` gates the actual delete: the first call (without confirm) returns a
// confirmation-required summary; only confirm:true forwards to the plugin.
const DELETE_ONE = schema(
  { nodeId: { type: "string" }, confirm: { type: "boolean" } },
  ["nodeId"],
);
const DELETE_MANY = schema(
  { nodeIds: { type: "array" }, confirm: { type: "boolean" } },
  ["nodeIds"],
);
const CREATE_IMAGE = schema(
  {
    imageUrl: { type: "string" },
    imageBase64: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    scaleMode: { type: "string" },
    name: { type: "string" },
    parentId: { type: "string" },
  },
  [],
);
const CLONE = schema(
  { nodeId: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
  ["nodeId"],
);
const RENAME_NODE = schema(
  { nodeId: { type: "string" }, name: { type: "string" } },
  ["nodeId", "name"],
);
const FOCUS = schema({ nodeId: { type: "string" } }, ["nodeId"]);
const SELECTIONS = schema({ nodeIds: { type: "array" } }, ["nodeIds"]);
const CONNECTOR_DEFAULT = schema({ connectorId: { type: "string" } }, []);
const CREATE_CONNECTIONS = schema(
  { connections: { type: "array" } },
  ["connections"],
);
const JOIN_CHANNEL = schema({ channel: { type: "string" } }, ["channel"]);

// set_range_font: apply font style/size to character ranges of a text node.
// ranges = [{start:number, end:number, fontStyle?:string, fontSize?:number}]
// fontFamily is optional — omitted means "keep node's current family".
const SET_RANGE_FONT = schema(
  {
    nodeId: { type: "string" },
    // Array of {start, end, fontStyle?, fontSize?} range descriptors.
    ranges: { type: "array" },
    // Optional override; if omitted the plugin infers from the node.
    fontFamily: { type: "string" },
  },
  ["nodeId", "ranges"],
);

export const VENDOR_WRITE_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({ name: "create_rectangle", description: "Create a rectangle in Figma.", inputSchema: CREATE_RECT }),
  Object.freeze({ name: "create_frame", description: "Create a frame in Figma (optionally with auto-layout).", inputSchema: CREATE_FRAME }),
  Object.freeze({ name: "create_text", description: "Create a text node in Figma.", inputSchema: CREATE_TEXT }),
  Object.freeze({ name: "create_image", description: "Place an image on the canvas as an IMAGE-filled rectangle. Pass imageUrl (the daemon fetches it — the plugin cannot reach the network) or imageBase64. Optional x/y/width/height/scaleMode/name/parentId.", inputSchema: CREATE_IMAGE }),
  Object.freeze({ name: "create_component_instance", description: "Place an instance of a component on the canvas.", inputSchema: COMPONENT_INSTANCE }),
  Object.freeze({ name: "set_fill_color", description: "Set the fill (RGBA 0-1) of a node.", inputSchema: FILL_COLOR }),
  Object.freeze({ name: "set_stroke_color", description: "Set the stroke color and weight of a node.", inputSchema: STROKE_COLOR }),
  Object.freeze({ name: "set_corner_radius", description: "Set corner radius (per-corner optional) on a node.", inputSchema: CORNER }),
  Object.freeze({ name: "set_text_content", description: "Set the text content of a text node.", inputSchema: SET_TEXT }),
  Object.freeze({ name: "set_multiple_text_contents", description: "Replace text in many text nodes in one call (chunked).", inputSchema: MULTI_TEXT }),
  Object.freeze({ name: "move_node", description: "Move a node to (x, y).", inputSchema: MOVE_NODE }),
  Object.freeze({ name: "resize_node", description: "Resize a node to width/height.", inputSchema: RESIZE_NODE }),
  Object.freeze({ name: "clone_node", description: "Clone an existing node at offset.", inputSchema: CLONE }),
  Object.freeze({ name: "rename_node", description: "Rename a node's layer name (any node type).", inputSchema: RENAME_NODE }),
  Object.freeze({ name: "delete_node", description: "Delete a node by id. WARNING destructive/irreversible — confirm the target with the user before calling.", inputSchema: DELETE_ONE }),
  Object.freeze({ name: "delete_multiple_nodes", description: "Delete many nodes in one call. WARNING destructive/irreversible bulk delete — confirm the node list with the user before calling.", inputSchema: DELETE_MANY }),
  Object.freeze({ name: "set_layout_mode", description: "Switch a frame to NONE / HORIZONTAL / VERTICAL auto-layout.", inputSchema: LAYOUT_MODE }),
  Object.freeze({ name: "set_padding", description: "Set padding (top/right/bottom/left) on an auto-layout frame.", inputSchema: PADDING }),
  Object.freeze({ name: "set_axis_align", description: "Set primary/counter axis alignment on an auto-layout frame.", inputSchema: AXIS_ALIGN }),
  Object.freeze({ name: "set_layout_sizing", description: "Set FIXED / HUG / FILL sizing on each axis.", inputSchema: LAYOUT_SIZING }),
  Object.freeze({ name: "set_item_spacing", description: "Set gap between auto-layout items.", inputSchema: ITEM_SPACING }),
  Object.freeze({ name: "set_annotation", description: "Set or update a single annotation on a node.", inputSchema: ANNOTATION }),
  Object.freeze({ name: "set_multiple_annotations", description: "Set annotations on many nodes in parallel.", inputSchema: MULTI_ANNOTATION }),
  Object.freeze({ name: "set_instance_overrides", description: "Apply overrides from a source instance to target instances.", inputSchema: SET_INSTANCE_OVERRIDES }),
  Object.freeze({ name: "swap_overrides_instances", description: "Swap component instances while preserving overrides.", inputSchema: SWAP_OVERRIDES }),
  Object.freeze({ name: "set_default_connector", description: "Set the default connector style for flow-diagram drawing.", inputSchema: CONNECTOR_DEFAULT }),
  Object.freeze({ name: "create_connections", description: "Create connectors between nodes (diagram edges).", inputSchema: CREATE_CONNECTIONS }),
  Object.freeze({ name: "set_focus", description: "Center the viewport on a node.", inputSchema: FOCUS }),
  Object.freeze({ name: "set_selections", description: "Set the current Figma selection to the given node ids.", inputSchema: SELECTIONS }),
  Object.freeze({ name: "join_channel", description: "Join a relay channel (idempotent — the daemon already joined at startup).", inputSchema: JOIN_CHANNEL }),
  Object.freeze({
    name: "set_range_font",
    description:
      "Apply font style/size to character ranges of a text node (preserves visual hierarchy after set_text_content). " +
      "ranges: [{start:number, end:number, fontStyle?:string, fontSize?:number}]. " +
      "fontFamily is optional — omitted keeps the node's current font family.",
    inputSchema: SET_RANGE_FONT,
  }),
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

export interface VendorWriteContext {
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

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MiB raw; base64 + envelope < relay 8 MiB cap

// Daemon-side image fetch: the plugin's networkAccess is localhost-only, so it
// cannot reach an arbitrary URL. The daemon fetches the bytes and forwards
// base64. Only http(s) is allowed (no file:/data: — SSRF/local-file guard).
async function fetchImageBase64(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("only http(s) image URLs are allowed");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }
  return buf.toString("base64");
}

const DELETE_COMMANDS = new Set(["delete_node", "delete_multiple_nodes"]);

export function createVendorWriteContext(
  opts: VendorContextOptions,
): VendorWriteContext {
  const dispatch = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResponse> => {
    // Destructive-op gate (human-in-the-loop): require an explicit confirm:true
    // second call. The first call returns a summary instead of deleting.
    if (DELETE_COMMANDS.has(name)) {
      if (args.confirm !== true) {
        const targets =
          name === "delete_node"
            ? [args.nodeId]
            : Array.isArray(args.nodeIds)
              ? args.nodeIds
              : [];
        return ok({
          requiresConfirmation: true,
          command: name,
          willDelete: targets,
          count: targets.length,
          message:
            `Destructive: ${targets.length} node(s) would be deleted. ` +
            `Confirm the target(s) with the user, then re-call ${name} with confirm:true.`,
        });
      }
      const { confirm: _omit, ...rest } = args;
      return forward(opts.client, name, rest);
    }

    // Image placement: resolve imageUrl → base64 daemon-side before forwarding.
    if (name === "create_image") {
      let imageBase64 =
        typeof args.imageBase64 === "string" ? args.imageBase64 : "";
      const imageUrl = typeof args.imageUrl === "string" ? args.imageUrl : "";
      if (!imageBase64 && imageUrl) {
        try {
          imageBase64 = await fetchImageBase64(imageUrl);
        } catch (e) {
          return err(`create_image fetch failed: ${(e as Error).message}`);
        }
      }
      if (!imageBase64) {
        return err("create_image requires imageUrl or imageBase64");
      }
      const { imageUrl: _u, imageBase64: _b, ...rest } = args;
      return forward(opts.client, name, { ...rest, imageBase64 });
    }

    return forward(opts.client, name, args);
  };
  return { tools: VENDOR_WRITE_TOOLS, dispatch };
}
