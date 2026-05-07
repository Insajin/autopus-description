// SPEC-FIGMA-005 T10: --batch lane runner.
// REQ-05, REQ-10. Composes BatchRequests for every frame, submits via the
// Anthropic Message Batches API, polls until ended, and reconstructs
// per-frame ManifestEntry + audit rows in input order. Partial failure
// preserves successful frames in the manifest and emits errors.jsonl
// alongside (REQ-10, AC-S6).
//
// Realtime lane keeps using semaphoreMap + processFrame in batch-executor.
// This module handles only the async batches code path and reuses the same
// entry-coerce / audit-emitter contract so cross-lane manifest_entry_hash
// equivalence holds (REQ-NFR-03, AC-S5).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import {
  ErrorCode,
  ProviderError,
  type LLMResponse,
  type ManifestEntry,
} from "./types/llm-provider.js";
import type { FrameInput } from "./routing.js";
import { Telemetry } from "./telemetry.js";
import { applyAntiHallucination } from "./validators/anti-hallucination.js";
import { detectInjection } from "./validators/post-hoc-injection-detector.js";
import { assertAjvValid } from "./validators/strict-bridge.js";
import { emitAuditRecord, type EmittedAudit } from "./audit-emitter.js";
import {
  defaultEntryShell,
  frameTextSamples,
  mergeLlmBody,
} from "./batch-entry-coerce.js";
import { buildNodeOnlyPrompt, flattenPrompt } from "./prompts/node-only.js";
import {
  alignByInputOrder,
  composeBatchRequest,
  fetchResults,
  pollUntilComplete,
  submitBatch,
  type BatchResultRow,
  type BatchResultSuccess,
} from "./providers/batch-lane.js";
import type { BatchError, StreamCapture } from "./batch-runtime.js";
import { buildErrorLine } from "./batch-runtime.js";

export interface BatchLaneCtx {
  client: Anthropic;
  frames: FrameInput[];
  telemetry: Telemetry;
  stderr: StreamCapture;
  temperature: number;
  model_id: string;
  audit_dir: string;
  batch_id: string;
  cache_control_region?: string;
  structured_output_schema?: object;
  validator_binary?: string;
  provider_sdk_version: string;
  poll_interval_ms?: number;
  max_wait_ms?: number;
}

export interface BatchLaneResult {
  entries: ManifestEntry[];
  errors: BatchError[];
  audits: EmittedAudit[];
  batch_id_provider: string;
}

function isSuccess(row: BatchResultRow): row is BatchResultSuccess {
  return row.result.type === "succeeded";
}

function extractText(row: BatchResultSuccess): string {
  return row.result.message.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "")
    .join("");
}

function llmResponseFromRow(
  row: BatchResultSuccess,
  sdkVersion: string,
): LLMResponse {
  const text = extractText(row);
  const usage = row.result.message.usage ?? {};
  let parsed: { confidence?: unknown; intent_mismatch?: unknown } = {};
  try {
    parsed = JSON.parse(text.trim()) as typeof parsed;
  } catch {
    /* low-confidence fallback */
  }
  const conf =
    typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const im =
    typeof parsed.intent_mismatch === "boolean" ? parsed.intent_mismatch : false;
  return {
    text,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    confidence: conf,
    intent_mismatch: im,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    dynamic_input_tokens: usage.input_tokens ?? 0,
    provider_sdk_version: sdkVersion,
    request_id: row.result.message.id,
  };
}

function writeErrorsJsonl(
  audit_dir: string,
  batch_id: string,
  errors: BatchError[],
): string | undefined {
  if (errors.length === 0) return undefined;
  const dir = join(audit_dir, batch_id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "errors.jsonl");
  const lines = errors.map((e) =>
    JSON.stringify({
      screen_id: e.screen_id,
      error_code: e.code,
      message: e.message,
    }),
  );
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
  return path;
}

export async function runBatchLane(
  ctx: BatchLaneCtx,
): Promise<BatchLaneResult> {
  const requests = ctx.frames.map((frame) => {
    const meta = frame.frame_meta;
    const promptTree = buildNodeOnlyPrompt(meta);
    const prompt = flattenPrompt(promptTree);
    return composeBatchRequest(frame.screen_id, prompt, undefined, {
      model_id: ctx.model_id,
      temperature: ctx.temperature,
      max_output_tokens: 2000,
      cache_control_region: ctx.cache_control_region,
      structured_output_schema: ctx.structured_output_schema,
    });
  });

  const batchIdProvider = await submitBatch(ctx.client, requests);
  process.stdout.write(`batch_id: ${batchIdProvider}\n`);
  await pollUntilComplete(ctx.client, batchIdProvider, {
    pollIntervalMs: ctx.poll_interval_ms,
    maxWaitMs: ctx.max_wait_ms,
  });
  const rows = await fetchResults(ctx.client, batchIdProvider);
  const aligned = alignByInputOrder(
    ctx.frames.map((f) => f.screen_id),
    rows,
  );

  const entries: ManifestEntry[] = [];
  const errors: BatchError[] = [];
  const audits: EmittedAudit[] = [];

  for (let i = 0; i < ctx.frames.length; i++) {
    const frame = ctx.frames[i];
    const row = aligned[i];
    if (!isSuccess(row)) {
      const e = row.result;
      errors.push({
        screen_id: frame.screen_id,
        code: ErrorCode.BATCH_PARTIAL_FAILURE,
        message: e.error?.message ?? `result.type=${e.type}`,
        attempt_count: 1,
      });
      ctx.stderr.push({
        code: ErrorCode.BATCH_PARTIAL_FAILURE,
        screen_id: frame.screen_id,
        message: e.error?.message ?? `result.type=${e.type}`,
      });
      continue;
    }
    const llmResp = llmResponseFromRow(row, ctx.provider_sdk_version);
    let entry = mergeLlmBody(defaultEntryShell(frame), llmResp.text);
    entry.confidence = llmResp.confidence;
    entry.intent_mismatch = llmResp.intent_mismatch;
    entry.token_usage = {
      input_tokens: llmResp.input_tokens,
      output_tokens: llmResp.output_tokens,
    };
    entry = applyAntiHallucination(entry);
    const det = detectInjection(entry, {
      frameTextSamples: frameTextSamples(frame),
    });
    entry.review_status = det.suspected ? "pending_review" : "approved";

    if (ctx.structured_output_schema) {
      try {
        assertAjvValid(entry, { validatorBinary: ctx.validator_binary });
      } catch (err) {
        const e = err as ProviderError;
        ctx.stderr.push(buildErrorLine(e, frame.screen_id));
        errors.push({
          screen_id: frame.screen_id,
          code: e.code,
          message: e.message,
          attempt_count: 1,
        });
        continue;
      }
    }

    ctx.telemetry.recordEntry(
      frame.screen_id,
      llmResp.input_tokens,
      llmResp.output_tokens,
      "node-only",
    );
    const audit = emitAuditRecord(
      {
        batch_id: ctx.batch_id,
        screen_id: frame.screen_id,
        provider: "AnthropicBatch",
        mode: "node-only",
        input_tokens: llmResp.input_tokens,
        output_tokens: llmResp.output_tokens,
        untrusted_text_processed: frameTextSamples(frame).length > 0,
        cache_hit: (llmResp.cache_read_input_tokens ?? 0) > 0,
        cache_read_input_tokens: llmResp.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: llmResp.cache_creation_input_tokens ?? 0,
        dynamic_input_tokens: llmResp.dynamic_input_tokens ?? 0,
        file_id: null,
        batch_id_provider: batchIdProvider,
        strict_mode_used: ctx.structured_output_schema !== undefined,
        provider_sdk_version: llmResp.provider_sdk_version ?? "unknown",
        prompt_text: "",
        response_text: llmResp.text,
      },
      ctx.audit_dir,
    );
    entries.push(entry);
    audits.push(audit);
  }

  writeErrorsJsonl(ctx.audit_dir, ctx.batch_id, errors);
  return { entries, errors, audits, batch_id_provider: batchIdProvider };
}
