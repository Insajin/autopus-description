// SPEC-FIGMA-003 T7: Adaptive Vision/Node routing engine.
// Step 1: Node-only call. Step 2: if confidence >= 0.7 (boundary inclusive),
// return. Step 3: confidence < 0.7 → Vision retry, adopt higher-confidence
// response. Token caps enforced before each LLM call (REQ-05) and after each
// response (REQ-06).

import {
  enforceInputCap,
  enforceOutputCap,
  predictInputTokens,
} from "./token-counter.js";
import {
  buildNodeOnlyPrompt,
  flattenPrompt,
  type FrameMeta,
} from "./prompts/node-only.js";
import { buildVisionPrompt } from "./prompts/vision.js";
import {
  type LLMProvider,
  type LLMResponse,
  type ProviderOpts,
} from "./types/llm-provider.js";

// Strict less-than per spec.md §4. Boundary 0.7 does NOT trigger Vision.
export const VISION_CUTOFF = 0.7;

export interface FrameInput {
  screen_id: string;
  source_hash: string;
  frame_meta: FrameMeta;
  screenshot_path: string;
}

export interface RoutingTelemetryHook {
  incrementVisionCount(): void;
}

export type RoutingMode = "node-only" | "auto";

export interface RoutingOptions {
  providerOpts: ProviderOpts;
  // "node-only" forces the routing engine to skip the Vision retry branch
  // regardless of confidence (AC-S14 uses this to test injection-only paths
  // without exercising Vision). Default behaviour ("auto") honors the
  // VISION_CUTOFF check.
  mode?: RoutingMode;
}

// Optional hook a provider can implement to override predicted input tokens
// (used by MockLLMProvider.forceMeasuredInputTokens for AC-S2).
interface MeasurableProvider {
  measureInputTokens?(prompt: string, image_present: boolean): number | null;
}

function measure(
  provider: LLMProvider,
  prompt: string,
  image_present: boolean,
  model_id: string,
): number {
  const m = (provider as MeasurableProvider).measureInputTokens?.(
    prompt,
    image_present,
  );
  if (typeof m === "number") return m;
  return predictInputTokens(prompt, image_present, model_id);
}

export type ModeUsed = "node-only" | "vision";

export interface RouteResult {
  response: LLMResponse;
  mode_used: ModeUsed;
  // Real prompt strings used for the LLM call(s). Hashed by the audit
  // emitter to give per-frame forensic uniqueness (REQ-NFR-03). Never
  // persisted to JSONL — emitAuditRecord computes SHA-256 then drops.
  prompt_node_only: string;
  prompt_vision?: string;
}

export async function routeAndGenerate(
  frame: FrameInput,
  provider: LLMProvider,
  telemetry: RoutingTelemetryHook,
  opts: RoutingOptions,
): Promise<RouteResult> {
  const { screen_id } = frame;
  const nodePrompt = buildNodeOnlyPrompt(frame.frame_meta);
  const flattenedNode = flattenPrompt(nodePrompt);

  enforceInputCap(
    measure(provider, flattenedNode, false, opts.providerOpts.model_id),
    screen_id,
  );
  const nodeResp = await provider.generateNodeOnly(
    flattenedNode,
    opts.providerOpts,
  );
  enforceOutputCap(nodeResp.output_tokens, screen_id);

  if (nodeResp.confidence >= VISION_CUTOFF || opts.mode === "node-only") {
    return {
      response: nodeResp,
      mode_used: "node-only",
      prompt_node_only: flattenedNode,
    };
  }

  telemetry.incrementVisionCount();
  const visionPrompt = buildVisionPrompt(frame.frame_meta, frame.screenshot_path);
  const flattenedVision = flattenPrompt(visionPrompt);

  enforceInputCap(
    measure(provider, flattenedVision, true, opts.providerOpts.model_id),
    screen_id,
  );
  const visionResp = await provider.generateVision(
    flattenedVision,
    visionPrompt.image_bytes,
    opts.providerOpts,
  );
  enforceOutputCap(visionResp.output_tokens, screen_id);

  // Adopt higher-confidence result; mode reflects which response we kept.
  if (visionResp.confidence > nodeResp.confidence) {
    return {
      response: visionResp,
      mode_used: "vision",
      prompt_node_only: flattenedNode,
      prompt_vision: flattenedVision,
    };
  }
  return {
    response: nodeResp,
    mode_used: "node-only",
    prompt_node_only: flattenedNode,
    prompt_vision: flattenedVision,
  };
}
