// SPEC-FIGMA-003 T10 helper: per-frame processing extracted from
// batch-executor to keep that file under the 300-line cap. Owns the LLM
// call sequencing, anti-hallucination, injection detection, telemetry,
// and audit emission for a single frame.
//
// SPEC-FIGMA-005 T9: 8 new audit fields populated per frame (cache split,
// file_id, batch_id_provider, strict_mode_used, provider_sdk_version).
// REQ-07 invariant maintained — none of these transient values flow into
// ManifestEntry; they live exclusively in the audit JSONL row.
// strict_bridge AJV second-pass is invoked when ctx.strict_mode is true
// (REQ-03). manifest_entry_hash is computed downstream by write-router.

import { ErrorCode, ProviderError } from "./types/llm-provider.js";
import type { LLMProvider, ManifestEntry } from "./types/llm-provider.js";
import { routeAndGenerate, type FrameInput } from "./routing.js";
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
import type { ResolvedRetry, StreamCapture, BatchError } from "./batch-runtime.js";
import { withRetry, buildErrorLine } from "./batch-runtime.js";

export interface ProcessCtx {
  provider: LLMProvider;
  telemetry: Telemetry;
  stderr: StreamCapture;
  retry: ResolvedRetry;
  temperature: number;
  model_id: string;
  audit_dir: string;
  batch_id: string;
  mode: "node-only" | "auto";
  // SPEC-FIGMA-005 additive context. All optional so callers built before
  // SPEC-FIGMA-005 (e.g., legacy tests) keep working.
  cache_control_region?: string;
  structured_output_schema?: object;
  batch_id_provider?: string;
  // file_id_for is consulted by the routing layer; we surface it in audit only.
  file_id_for?: (sha256: string) => string | undefined;
  validator_binary?: string;
}

export interface FrameOutcome {
  entry?: ManifestEntry;
  error?: BatchError;
  audit?: EmittedAudit;
}

export async function processFrame(
  frame: FrameInput,
  ctx: ProcessCtx,
): Promise<FrameOutcome> {
  const cachedFileId = ctx.file_id_for?.(frame.source_hash);
  const providerOpts = {
    temperature: ctx.temperature,
    model_id: ctx.model_id,
    max_output_tokens: 2000,
    cache_control_region: ctx.cache_control_region,
    structured_output_schema: ctx.structured_output_schema,
    file_id: cachedFileId,
  };
  let attempts = 1;
  let llmResp;
  let modeUsed: "node-only" | "vision" = "node-only";
  let promptForHash = "";
  try {
    const out = await withRetry(
      () =>
        routeAndGenerate(
          frame,
          ctx.provider,
          { incrementVisionCount: () => ctx.telemetry.incrementVisionCount() },
          { providerOpts, mode: ctx.mode },
        ),
      ctx.retry,
    );
    attempts = out.attempts;
    llmResp = out.value.response;
    modeUsed = out.value.mode_used;
    promptForHash = out.value.prompt_vision
      ? `${out.value.prompt_node_only}\n---VISION---\n${out.value.prompt_vision}`
      : out.value.prompt_node_only;
  } catch (err) {
    const e =
      err instanceof ProviderError
        ? err
        : new ProviderError(ErrorCode.PROVIDER_ERROR, String(err));
    ctx.stderr.push(buildErrorLine(e, frame.screen_id));
    return {
      error: {
        screen_id: frame.screen_id,
        code: e.code,
        message: e.message,
        attempt_count: attempts,
      },
    };
  }

  if (
    llmResp.confidence < 0 ||
    llmResp.confidence > 1 ||
    Number.isNaN(llmResp.confidence)
  ) {
    ctx.stderr.push({
      code: ErrorCode.OUT_OF_RANGE,
      json_pointer: "/entries/0/confidence",
      message: `confidence ${llmResp.confidence} outside [0.0, 1.0]`,
    });
    return {
      error: {
        screen_id: frame.screen_id,
        code: ErrorCode.OUT_OF_RANGE,
        message: "confidence range",
        attempt_count: attempts,
      },
    };
  }

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
  if (det.suspected) {
    ctx.stderr.push({
      code: ErrorCode.PROMPT_INJECTION_SUSPECTED,
      screen_id: frame.screen_id,
      markers_detected: det.markers,
    });
  }

  // REQ-03: when strict mode is engaged, run the AJV second-pass before the
  // entry is admitted to the manifest. AJV failure surfaces as
  // SCHEMA_AJV_VIOLATION; the entry is dropped from the manifest output.
  if (ctx.structured_output_schema) {
    try {
      assertAjvValid(entry, { validatorBinary: ctx.validator_binary });
    } catch (err) {
      const e = err as ProviderError;
      ctx.stderr.push(buildErrorLine(e, frame.screen_id));
      return {
        error: {
          screen_id: frame.screen_id,
          code: e.code,
          message: e.message,
          attempt_count: attempts,
        },
      };
    }
  }

  ctx.telemetry.recordEntry(
    frame.screen_id,
    llmResp.input_tokens,
    llmResp.output_tokens,
    modeUsed,
  );

  const audit = emitAuditRecord(
    {
      batch_id: ctx.batch_id,
      screen_id: frame.screen_id,
      provider: ctx.provider.constructor.name,
      mode: modeUsed,
      input_tokens: llmResp.input_tokens,
      output_tokens: llmResp.output_tokens,
      untrusted_text_processed: frameTextSamples(frame).length > 0,
      // SPEC-FIGMA-005 REQ-08 audit fields.
      cache_hit: (llmResp.cache_read_input_tokens ?? 0) > 0,
      cache_read_input_tokens: llmResp.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: llmResp.cache_creation_input_tokens ?? 0,
      dynamic_input_tokens: llmResp.dynamic_input_tokens ?? llmResp.input_tokens,
      file_id: llmResp.file_id ?? cachedFileId ?? null,
      batch_id_provider: ctx.batch_id_provider ?? null,
      strict_mode_used: ctx.structured_output_schema !== undefined,
      provider_sdk_version: llmResp.provider_sdk_version ?? "unknown",
      prompt_text: promptForHash,
      response_text: llmResp.text,
    },
    ctx.audit_dir,
  );

  return { entry, audit };
}
