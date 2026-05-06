// SPEC-FIGMA-003 T10 helper: per-frame processing extracted from
// batch-executor to keep that file under the 300-line cap. Owns the LLM
// call sequencing, anti-hallucination, injection detection, telemetry,
// and audit emission for a single frame.

import { ErrorCode, ProviderError } from "./types/llm-provider.js";
import type { LLMProvider, ManifestEntry } from "./types/llm-provider.js";
import { routeAndGenerate, type FrameInput } from "./routing.js";
import { Telemetry } from "./telemetry.js";
import { applyAntiHallucination } from "./validators/anti-hallucination.js";
import { detectInjection } from "./validators/post-hoc-injection-detector.js";
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
  const providerOpts = {
    temperature: ctx.temperature,
    model_id: ctx.model_id,
    max_output_tokens: 2000,
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
      prompt_text: promptForHash,
      response_text: llmResp.text,
    },
    ctx.audit_dir,
  );

  return { entry, audit };
}
