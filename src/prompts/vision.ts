// SPEC-FIGMA-003 T6: Vision-augmented prompt builder.
// Reuses the node-only prompt body and appends a Vision-specific instruction.
// Image bytes are loaded synchronously; the Node >=22 runtime tolerates fs.readFileSync
// for small one-shot reads.

import { existsSync, readFileSync } from "node:fs";

import { ErrorCode, ProviderError } from "../types/llm-provider.js";
import {
  buildNodeOnlyPrompt,
  type BuiltPrompt,
  type FrameMeta,
  type PromptOpts,
} from "./node-only.js";

const VISION_INSTRUCTION = `An image of the frame is attached. Use it to disambiguate visual intent, numbered annotation regions, user flow, states, controls, hierarchy, and policy-relevant details when the node tree is insufficient. If the image and node tree disagree, set "intent_mismatch": true and explain the mismatch in the "intent" field.`;

export interface BuiltVisionPrompt extends BuiltPrompt {
  image_bytes: Buffer;
}

export function buildVisionPrompt(
  frame_meta: FrameMeta,
  screenshot_path: string,
  opts: PromptOpts = {},
): BuiltVisionPrompt {
  if (!existsSync(screenshot_path)) {
    throw new ProviderError(
      ErrorCode.PROVIDER_ERROR,
      `Screenshot file missing for ${frame_meta.screen_id}: ${screenshot_path}`,
      frame_meta.screen_id,
      { screenshot_path },
    );
  }
  const base = buildNodeOnlyPrompt(frame_meta, opts);
  const system = `${base.system}\n\n${VISION_INSTRUCTION}`;
  const image_bytes = readFileSync(screenshot_path);
  return {
    system,
    user: base.user,
    image_bytes,
  };
}

export const VISION_SYSTEM_INSTRUCTION = VISION_INSTRUCTION;
