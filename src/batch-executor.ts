// SPEC-FIGMA-003 T10: Batch executor — parallelism cap, 429 backoff,
// per-frame processing delegated to batch-process-frame.ts. Shared
// helpers (semaphore, retry, stream capture) live in batch-runtime.ts.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LLMProvider, ManifestEntry } from "./types/llm-provider.js";
import type { FrameInput } from "./routing.js";
import { Telemetry } from "./telemetry.js";
import type { EmittedAudit } from "./audit-emitter.js";
import {
  StreamCapture,
  semaphoreMap,
  type BatchError,
  type ResolvedRetry,
} from "./batch-runtime.js";
import { processFrame, type ProcessCtx } from "./batch-process-frame.js";

// All fields optional in the public surface so callers may pass partial
// retry config (e.g. `{ base_ms: 1000 }`); defaults from DEFAULT_RETRY merge in.
export interface RetryOpts {
  base_ms?: number;
  factor?: number;
  max_attempts?: number;
}

export interface BatchOpts {
  frames: FrameInput[];
  provider: LLMProvider;
  output: string;
  parallelism?: number;
  temperature?: number;
  retry?: RetryOpts;
  mode?: "node-only" | "auto";
  audit_dir?: string;
  model_id?: string;
  pm_reviewer_id?: string;
  pilot_date?: string;
  figma_file_ids?: string[];
}

export type { BatchError } from "./batch-runtime.js";

export interface BatchResult {
  exit_code: number;
  stderr: string;
  stdout: string;
  audit_entries: EmittedAudit[];
  errors: BatchError[];
}

const DEFAULT_RETRY: ResolvedRetry = { base_ms: 1000, factor: 2, max_attempts: 3 };
const DEFAULT_MODEL = "claude-opus-4-7-20260115";
const DEFAULT_AUDIT_DIR = ".audit";

function resolveRetry(opts?: RetryOpts): ResolvedRetry {
  return {
    base_ms: opts?.base_ms ?? DEFAULT_RETRY.base_ms,
    factor: opts?.factor ?? DEFAULT_RETRY.factor,
    max_attempts: opts?.max_attempts ?? DEFAULT_RETRY.max_attempts,
  };
}

function buildManifest(
  entries: ManifestEntry[],
  telemetry: Telemetry,
  opts: BatchOpts,
): object {
  const final = telemetry.finalize();
  return {
    schema_version: "0.2.0",
    pilot_metadata: {
      pm_reviewer_id: opts.pm_reviewer_id ?? "ci-mock",
      pilot_date: opts.pilot_date ?? new Date().toISOString().slice(0, 10),
      figma_file_ids: opts.figma_file_ids ?? ["mock-figma-file"],
      total_token_cost: final.total_token_cost,
      vision_call_count: final.vision_call_count,
      run_timestamp: new Date().toISOString(),
      model_id: opts.model_id ?? DEFAULT_MODEL,
      per_mode_breakdown: final.per_mode_breakdown,
    },
    frames: entries,
  };
}

export async function runBatch(opts: BatchOpts): Promise<BatchResult> {
  const stderr = new StreamCapture();
  const telemetry = new Telemetry();
  const audits: EmittedAudit[] = [];
  const entries: ManifestEntry[] = [];
  const errors: BatchError[] = [];
  const batch_id = createHash("sha256")
    .update(opts.frames.map((f) => f.screen_id).join("|"))
    .digest("hex")
    .slice(0, 16);
  const ctx: ProcessCtx = {
    provider: opts.provider,
    telemetry,
    stderr,
    retry: resolveRetry(opts.retry),
    temperature: opts.temperature ?? 0,
    model_id: opts.model_id ?? DEFAULT_MODEL,
    audit_dir: opts.audit_dir ?? DEFAULT_AUDIT_DIR,
    batch_id,
    mode: opts.mode ?? "auto",
  };

  const outcomes = await semaphoreMap(
    opts.frames,
    opts.parallelism ?? 5,
    (f) => processFrame(f, ctx),
  );
  for (const o of outcomes) {
    if (o.entry) entries.push(o.entry);
    if (o.error) errors.push(o.error);
    if (o.audit) audits.push(o.audit);
  }

  const manifest = buildManifest(entries, telemetry, opts);
  mkdirSync(dirname(opts.output), { recursive: true });
  writeFileSync(opts.output, JSON.stringify(manifest, null, 2), "utf-8");
  const exit_code = errors.length === 0 ? 0 : 1;
  const stdout = `RESULT pass=${entries.length} fail=${errors.length} total=${entries.length + errors.length}\n`;
  return {
    exit_code,
    stderr: stderr.text(),
    stdout,
    audit_entries: audits,
    errors,
  };
}
