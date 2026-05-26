// SPEC-FIGMA-014 REQ-01 / REQ-03 / REQ-05 / REQ-06 — Extra read-tool surface
// for the stdio MCP wire. Wires `figma_list_frames`, `figma_get_frame_meta`,
// `figma_export_image`, `figma_get_prototype_graph`, and `validate_manifest`
// behind an optional dispatch context so the SPEC-FIGMA-009 INV-W4a baseline
// (4 frozen read-only tools) stays observable to callers that do not provide
// an adapter.
//
// All outbound `text` payloads pass through `redact` (INV-W2). Figma adapter
// calls MUST be HTTP GET only (INV-FIGMA-READ); enforced by the adapter
// contract in `types/figma-read-adapter.d.ts`.

import { redact } from "../token-redactor.js";
import type {
  FigmaReadAdapter,
  ImageScale,
} from "../../types/figma-read-adapter.js";
import type { ToolDescriptor } from "./mcp-stdio-handlers.js";
import type { ToolResponse } from "./mcp-stdio-write-handlers.js";

type Schema = ToolDescriptor["inputSchema"];

function schema(
  props: Record<string, { type: "string" | "number" }>,
  required: string[],
): Schema {
  return {
    type: "object",
    properties: props as unknown as Record<string, never>,
    additionalProperties: false,
    ...({ required } as object),
  } as unknown as Schema;
}

const FILE_ID_ONLY = schema({ file_id: { type: "string" } }, ["file_id"]);
const FILE_AND_NODE = schema(
  { file_id: { type: "string" }, node_id: { type: "string" } },
  ["file_id", "node_id"],
);
const FILE_NODE_SCALE = schema(
  {
    file_id: { type: "string" },
    node_id: { type: "string" },
    scale: { type: "number" },
  },
  ["file_id", "node_id"],
);
const VALIDATE_SCHEMA = schema(
  { manifest_path: { type: "string" } },
  [],
);

/* @AX:ANCHOR: [AUTO] fan-in=4 — SPEC-FIGMA-014 extra read tool surface; appended
 * AFTER the frozen SPEC-FIGMA-009 baseline at positions 5-9 in ListTools.
 * @AX:REASON: order is part of the wire contract; AC-T1 / AC-T2 assert positions
 * 1-4 byte-equal SPEC-FIGMA-009 and 5-9 follow this array order. */
export const EXTRA_READ_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "figma_list_frames",
    description:
      "List top-level frames in a Figma file via the official REST API (read-only).",
    inputSchema: FILE_ID_ONLY,
  }),
  Object.freeze({
    name: "figma_get_frame_meta",
    description:
      "Return per-frame metadata (name, page, prototype edges, tokens) via Figma REST.",
    inputSchema: FILE_AND_NODE,
  }),
  Object.freeze({
    name: "figma_export_image",
    description:
      "Export a frame as PNG bytes (base64) at the requested scale (default 2x).",
    inputSchema: FILE_NODE_SCALE,
  }),
  Object.freeze({
    name: "figma_get_prototype_graph",
    description:
      "Return the prototype graph (entry node + transitions) for a Figma file.",
    inputSchema: FILE_ID_ONLY,
  }),
  Object.freeze({
    name: "validate_manifest",
    description:
      "Validate a description manifest file against SPEC-FIGMA-001 schema.",
    inputSchema: VALIDATE_SCHEMA,
  }),
]);

export const EXTRA_READ_NAMES: ReadonlySet<string> = new Set(
  EXTRA_READ_TOOLS.map((t) => t.name),
);

export interface ManifestValidator {
  validate(manifestPath: string): Promise<{
    valid: boolean;
    errors: Array<{ code: string; json_pointer: string; message: string }>;
    frame_count: number;
  }>;
}

export interface ExtraReadToolContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

export interface CreateExtraReadToolContextOptions {
  readonly adapter: FigmaReadAdapter;
  readonly validator: ManifestValidator;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asScale(v: unknown): ImageScale {
  return v === 1 ? 1 : 2;
}

function err(message: string): ToolResponse {
  return { content: [{ type: "text", text: redact(message) }], isError: true };
}

function ok(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: redact(JSON.stringify(payload)) }],
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function listFrames(
  adapter: FigmaReadAdapter,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const file_id = asString(args.file_id);
  if (!file_id) return err("invalid figma_list_frames args: file_id required");
  try {
    const frames = await adapter.listTopLevelFrames(file_id);
    return ok({ frames });
  } catch (e) {
    return err(`figma_list_frames failed: ${(e as Error).message}`);
  }
}

async function getFrameMeta(
  adapter: FigmaReadAdapter,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const file_id = asString(args.file_id);
  const node_id = asString(args.node_id);
  if (!file_id || !node_id) {
    return err("invalid figma_get_frame_meta args: file_id and node_id required");
  }
  try {
    const meta = await adapter.getFrameMeta(file_id, node_id);
    return ok({ meta });
  } catch (e) {
    return err(`figma_get_frame_meta failed: ${(e as Error).message}`);
  }
}

async function exportImage(
  adapter: FigmaReadAdapter,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const file_id = asString(args.file_id);
  const node_id = asString(args.node_id);
  const scale = asScale(args.scale);
  if (!file_id || !node_id) {
    return err("invalid figma_export_image args: file_id and node_id required");
  }
  try {
    const bytes = await adapter.exportFrameImage(file_id, node_id, scale);
    return ok({
      image_bytes_base64: bytesToBase64(bytes),
      content_type: "image/png",
      scale,
    });
  } catch (e) {
    return err(`figma_export_image failed: ${(e as Error).message}`);
  }
}

async function getPrototypeGraph(
  adapter: FigmaReadAdapter,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const file_id = asString(args.file_id);
  if (!file_id) {
    return err("invalid figma_get_prototype_graph args: file_id required");
  }
  try {
    const graph = await adapter.getPrototypeGraph(file_id);
    return ok({ graph });
  } catch (e) {
    return err(`figma_get_prototype_graph failed: ${(e as Error).message}`);
  }
}

async function validateManifest(
  validator: ManifestValidator,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const manifest_path = asString(args.manifest_path);
  if (!manifest_path) {
    return err("invalid validate_manifest args: manifest_path required");
  }
  try {
    const result = await validator.validate(manifest_path);
    return ok(result);
  } catch (e) {
    return err(`validate_manifest failed: ${(e as Error).message}`);
  }
}

export function createExtraReadToolContext(
  opts: CreateExtraReadToolContextOptions,
): ExtraReadToolContext {
  return {
    tools: EXTRA_READ_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "figma_list_frames":
          return listFrames(opts.adapter, args);
        case "figma_get_frame_meta":
          return getFrameMeta(opts.adapter, args);
        case "figma_export_image":
          return exportImage(opts.adapter, args);
        case "figma_get_prototype_graph":
          return getPrototypeGraph(opts.adapter, args);
        case "validate_manifest":
          return validateManifest(opts.validator, args);
        default:
          return err(`unknown extra read tool: ${name}`);
      }
    },
  };
}
