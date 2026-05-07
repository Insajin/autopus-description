// SPEC-FIGMA-005 T8: Anthropic Message Batches API wrapper.
// REQ-05, REQ-10. Submits all frames in one create call, polls retrieve
// until processing_status === "ended", and reads result rows. Partial
// failure is surfaced as BATCH_PARTIAL_FAILURE with per-frame error rows so
// runBatch can persist successful frames and emit errors.jsonl (AC-S6).
//
// custom_id ↔ screen_id is the single carrier of input ordering — Anthropic
// returns rows in arbitrary order, and we re-sort by the input frame index
// using the custom_id map.

import type Anthropic from "@anthropic-ai/sdk";

import {
  ErrorCode,
  ProviderError,
  type ProviderOpts,
} from "../types/llm-provider.js";

export interface BatchRequest {
  custom_id: string;
  // Subset of Anthropic Messages API params we forward verbatim.
  params: {
    model: string;
    max_tokens: number;
    temperature: number;
    system?: Array<Record<string, unknown>>;
    messages: Array<{ role: string; content: unknown }>;
    response_format?: Record<string, unknown>;
  };
}

export interface BatchResultSuccess {
  custom_id: string;
  result: {
    type: "succeeded";
    message: {
      id?: string;
      content: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
  };
}

export interface BatchResultError {
  custom_id: string;
  result: {
    type: "errored" | "canceled" | "expired";
    error?: { type?: string; message?: string };
  };
}

export type BatchResultRow = BatchResultSuccess | BatchResultError;

export interface PollOpts {
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_WAIT_MS = 24 * 60 * 60 * 1000; // 24h Anthropic Batches SLA.

interface BatchClientShape {
  messages?: {
    batches?: {
      create: (req: { requests: BatchRequest[] }) => Promise<{ id: string }>;
      retrieve: (id: string) => Promise<{
        id: string;
        processing_status: "in_progress" | "ended" | "canceling" | "canceled";
        results_url?: string;
        request_counts?: {
          processing?: number;
          succeeded?: number;
          errored?: number;
          canceled?: number;
          expired?: number;
        };
      }>;
      results: (id: string) => AsyncIterable<BatchResultRow>;
    };
  };
}

function getBatchesNs(client: Anthropic): NonNullable<
  NonNullable<BatchClientShape["messages"]>["batches"]
> {
  const c = client as unknown as BatchClientShape;
  const ns = c.messages?.batches;
  if (!ns) {
    throw new ProviderError(
      ErrorCode.PROVIDER_SDK_BREAKING_CHANGE,
      "Anthropic SDK does not expose messages.batches namespace",
    );
  }
  return ns;
}

/**
 * Submit a batch of message requests. Returns the provider batch_id.
 * REQ-05: one create call covers all frames.
 */
export async function submitBatch(
  client: Anthropic,
  requests: BatchRequest[],
): Promise<string> {
  const ns = getBatchesNs(client);
  try {
    const resp = await ns.create({ requests });
    return resp.id;
  } catch (err) {
    throw mapBatchError(err);
  }
}

/**
 * Poll retrieve() until processing_status === "ended" or terminal failure.
 * Throws on canceling/canceled/expired or after maxWaitMs deadline.
 */
export async function pollUntilComplete(
  client: Anthropic,
  batch_id: string,
  opts: PollOpts = {},
): Promise<{ succeeded: number; errored: number }> {
  const ns = getBatchesNs(client);
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  while (true) {
    const status = await ns.retrieve(batch_id);
    if (status.processing_status === "ended") {
      return {
        succeeded: status.request_counts?.succeeded ?? 0,
        errored: status.request_counts?.errored ?? 0,
      };
    }
    if (
      status.processing_status === "canceling" ||
      status.processing_status === "canceled"
    ) {
      throw new ProviderError(
        ErrorCode.BATCH_PARTIAL_FAILURE,
        `Batch ${batch_id} entered terminal state ${status.processing_status} before completion`,
      );
    }
    if (Date.now() >= deadline) {
      throw new ProviderError(
        ErrorCode.BATCH_PARTIAL_FAILURE,
        `Batch ${batch_id} polling exceeded maxWaitMs`,
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Fetch all result rows for a completed batch. Order is provider-determined;
 * caller MUST re-sort by input order using the custom_id map.
 */
export async function fetchResults(
  client: Anthropic,
  batch_id: string,
): Promise<BatchResultRow[]> {
  const ns = getBatchesNs(client);
  const out: BatchResultRow[] = [];
  try {
    for await (const row of ns.results(batch_id)) {
      out.push(row);
    }
  } catch (err) {
    throw mapBatchError(err);
  }
  return out;
}

/**
 * Compose the per-frame BatchRequest body. Mirrors the AnthropicClaudeAdapter
 * messages.create payload so a frame produces byte-identical params whether
 * --realtime or --batch lane is selected.
 */
export function composeBatchRequest(
  custom_id: string,
  prompt: string,
  image: Buffer | undefined,
  opts: ProviderOpts,
): BatchRequest {
  const userBlocks: Array<Record<string, unknown>> = [];
  if (image) {
    if (opts.file_id) {
      userBlocks.push({
        type: "image",
        source: { type: "file", file_id: opts.file_id },
      });
    } else {
      userBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: image.toString("base64"),
        },
      });
    }
  }
  userBlocks.push({ type: "text", text: prompt });
  const systemBlocks: Array<Record<string, unknown>> = [];
  if (opts.cache_control_region) {
    systemBlocks.push({
      type: "text",
      text: opts.cache_control_region,
      cache_control: { type: "ephemeral" },
    });
  }
  const params: BatchRequest["params"] = {
    model: opts.model_id,
    max_tokens: opts.max_output_tokens,
    temperature: opts.temperature,
    messages: [{ role: "user", content: userBlocks }],
  };
  if (systemBlocks.length > 0) params.system = systemBlocks;
  if (opts.structured_output_schema) {
    params.response_format = {
      type: "json_schema",
      json_schema: {
        strict: true,
        schema: opts.structured_output_schema,
      },
    };
  }
  return { custom_id, params };
}

/**
 * Restore input order from the result rows using the custom_id index map.
 * Returns rows aligned with the input array; missing rows are returned as
 * synthetic errored rows (BATCH_PARTIAL_FAILURE) so caller has explicit
 * per-frame status (no silent gap).
 */
export function alignByInputOrder(
  inputOrder: string[],
  rows: BatchResultRow[],
): BatchResultRow[] {
  const byCustomId = new Map<string, BatchResultRow>();
  for (const r of rows) byCustomId.set(r.custom_id, r);
  const aligned: BatchResultRow[] = [];
  for (const id of inputOrder) {
    const row = byCustomId.get(id);
    if (row) {
      aligned.push(row);
    } else {
      aligned.push({
        custom_id: id,
        result: {
          type: "errored",
          error: {
            type: "missing_result",
            message: `No result row for custom_id ${id}`,
          },
        },
      });
    }
  }
  return aligned;
}

function mapBatchError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { status?: number; message?: string };
  const msg = e?.message ?? "Anthropic Batches API call failed";
  return new ProviderError(ErrorCode.PROVIDER_ERROR, msg, undefined, {
    http_status: e?.status,
  });
}
