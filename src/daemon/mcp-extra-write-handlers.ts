// SPEC-FIGMA-014 REQ-02 / REQ-05 — Extra write-tool surface for the stdio MCP
// wire. Wires `generate_description` so MCP clients can request a single-frame
// description without invoking the `generate-descriptions` CLI.
//
// This file is intentionally separate from `mcp-stdio-write-handlers.ts` so the
// SPEC-FIGMA-011 INV-W4b 5-entry write surface stays frozen as a byte-equal
// reference. Generation is dispatched ONLY when an LLM provider is wired at
// daemon startup.

import { redact } from "../token-redactor.js";
import type {
  LLMProvider,
  ManifestEntry,
} from "../types/llm-provider.js";
import type { FigmaReadAdapter } from "../../types/figma-read-adapter.js";
import type { ToolDescriptor } from "./mcp-stdio-handlers.js";
import type { ToolResponse } from "./mcp-stdio-write-handlers.js";

type Schema = ToolDescriptor["inputSchema"];

function schema(
  props: Record<string, { type: "string" }>,
  required: string[],
): Schema {
  return {
    type: "object",
    properties: props as unknown as Record<string, never>,
    additionalProperties: false,
    ...({ required } as object),
  } as unknown as Schema;
}

const GENERATE_SCHEMA = schema(
  {
    file_id: { type: "string" },
    node_id: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    mode: { type: "string" },
  },
  ["file_id", "node_id"],
);

/* @AX:ANCHOR: [AUTO] fan-in=2 — SPEC-FIGMA-014 extra write tool surface;
 * appended AFTER the SPEC-FIGMA-011 5-entry write block at position 15.
 * @AX:REASON: INV-W4b (positions 10-14 byte-equal SPEC-FIGMA-011) — adding
 * entries before position 15 violates the frozen contract. */
export const EXTRA_WRITE_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "generate_description",
    description:
      "Generate a single-frame description via the configured LLM provider; returns a ManifestEntry.",
    inputSchema: GENERATE_SCHEMA,
  }),
]);

export const EXTRA_WRITE_NAMES: ReadonlySet<string> = new Set(
  EXTRA_WRITE_TOOLS.map((t) => t.name),
);

export interface ExtraWriteToolContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

export interface DescriptionGenerator {
  generate(input: {
    file_id: string;
    node_id: string;
    mode: "auto" | "node-only";
  }): Promise<ManifestEntry>;
}

export interface CreateExtraWriteToolContextOptions {
  readonly generator: DescriptionGenerator;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asMode(v: unknown): "auto" | "node-only" {
  return v === "node-only" ? "node-only" : "auto";
}

function err(message: string): ToolResponse {
  return { content: [{ type: "text", text: redact(message) }], isError: true };
}

function ok(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: redact(JSON.stringify(payload)) }],
  };
}

async function generateDescription(
  generator: DescriptionGenerator,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const file_id = asString(args.file_id);
  const node_id = asString(args.node_id);
  if (!file_id || !node_id) {
    return err(
      "invalid generate_description args: file_id and node_id required",
    );
  }
  const mode = asMode(args.mode);
  try {
    const entry = await generator.generate({ file_id, node_id, mode });
    return ok({
      schema_version: "0.2.0",
      entry,
    });
  } catch (e) {
    return err(`generate_description failed: ${(e as Error).message}`);
  }
}

export function createExtraWriteToolContext(
  opts: CreateExtraWriteToolContextOptions,
): ExtraWriteToolContext {
  return {
    tools: EXTRA_WRITE_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "generate_description":
          return generateDescription(opts.generator, args);
        default:
          return err(`unknown extra write tool: ${name}`);
      }
    },
  };
}

/**
 * Default DescriptionGenerator that pairs a Figma read adapter with an LLM
 * provider. Single-frame generation skips the multi-frame batch executor and
 * instead calls the provider directly with a minimal prompt; this is sufficient
 * for the MCP path because batching (SPEC-FIGMA-005) is handled separately by
 * SPEC-FIGMA-016 `submit_batch_lane`.
 */
export class AdapterBackedDescriptionGenerator implements DescriptionGenerator {
  constructor(
    private readonly adapter: FigmaReadAdapter,
    private readonly provider: LLMProvider,
    private readonly model_id: string = "claude-sonnet-4-6",
  ) {}

  async generate(input: {
    file_id: string;
    node_id: string;
    mode: "auto" | "node-only";
  }): Promise<ManifestEntry> {
    const meta = await this.adapter.getFrameMeta(input.file_id, input.node_id);
    const prompt = [
      `Frame: ${meta.frame_name}`,
      `Page: ${meta.page_name}`,
      `Section: ${meta.parent_section_name ?? "(none)"}`,
      `Outgoing edges: ${meta.outgoing_prototype_edges.length}`,
      `Component instances: ${meta.child_component_instances.length}`,
      `Describe intent, user_value, success_criteria, states, edge_cases.`,
    ].join("\n");

    let response;
    if (input.mode === "node-only") {
      response = await this.provider.generateNodeOnly(prompt, {
        temperature: 0,
        model_id: this.model_id,
        max_output_tokens: 1024,
      });
    } else {
      const image = await this.adapter.exportFrameImage(
        input.file_id,
        input.node_id,
        2,
      );
      response = await this.provider.generateVision(
        prompt,
        Buffer.from(image),
        {
          temperature: 0,
          model_id: this.model_id,
          max_output_tokens: 1024,
        },
      );
    }

    return {
      screen_id: meta.figma_node_id,
      display_id: meta.frame_name,
      title: meta.frame_name,
      intent: response.text.slice(0, 200),
      user_value: "",
      success_criteria: "",
      states: [],
      edge_cases: [],
      component_refs: meta.child_component_instances.map((c) => c.componentKey),
      data_io: [],
      design_tokens: (meta.design_tokens ?? []) as string[],
      variants: (meta.variants ?? []) as string[],
      navigation: meta.outgoing_prototype_edges.map((e) => `${e.from}→${e.to}`),
      confidence: response.confidence,
      intent_mismatch: response.intent_mismatch,
      source_hash: "",
      write_target: "annotation_card",
      persona_tags: ["pm"],
      token_usage: {
        input_tokens: response.input_tokens,
        output_tokens: response.output_tokens,
      },
    } as ManifestEntry;
  }
}
