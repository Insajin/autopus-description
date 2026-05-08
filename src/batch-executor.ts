// SPEC-FIGMA-003 T10: Batch executor — parallelism cap, 429 backoff,
// per-frame processing delegated to batch-process-frame.ts. Shared
// helpers (semaphore, retry, stream capture) live in batch-runtime.ts.
//
// SPEC-FIGMA-005 T10: --batch / --realtime lane dispatch + aggregate
// summary stdout (REQ-05, REQ-06, REQ-22). Realtime path is the existing
// semaphoreMap loop; batch path delegates to batch-lane-runner.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LLMProvider, ManifestEntry } from "./types/llm-provider.js";
import type { FrameInput } from "./routing.js";
import { Telemetry } from "./telemetry.js";
import {
  computeAggregateSummary,
  formatAggregateSummary,
  type EmittedAudit,
} from "./audit-emitter.js";
import {
  StreamCapture,
  semaphoreMap,
  type BatchError,
  type ResolvedRetry,
} from "./batch-runtime.js";
import { processFrame, type ProcessCtx } from "./batch-process-frame.js";
import { runBatchLane } from "./batch-lane-runner.js";
import { FileIdCache } from "./providers/files-cache.js";
import type { ProjectBrief } from "./project-brief.js";

export interface RetryOpts {
  base_ms?: number;
  factor?: number;
  max_attempts?: number;
}

export type Lane = "realtime" | "batch";

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
  // SPEC-FIGMA-005 additive fields. All optional so legacy callers keep
  // working without modification.
  lane?: Lane;
  cache_control_region?: string;
  structured_output_schema?: object;
  validator_binary?: string;
  // Test injection point: pre-resolved provider SDK version string. Used by
  // batch-lane-runner audit rows when the provider does not surface one.
  provider_sdk_version?: string;
  // Test injection point: client for batch lane API calls. When omitted the
  // executor attempts to read it off the provider (AnthropicClaudeAdapter).
  batch_client?: unknown;
  project_brief?: ProjectBrief;
}

export type { BatchError } from "./batch-runtime.js";

export interface BatchResult {
  exit_code: number;
  stderr: string;
  stdout: string;
  audit_entries: EmittedAudit[];
  errors: BatchError[];
  batch_id_provider?: string;
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

async function runRealtime(
  opts: BatchOpts,
  ctx: ProcessCtx,
  filesCache: FileIdCache,
): Promise<{ entries: ManifestEntry[]; errors: BatchError[]; audits: EmittedAudit[] }> {
  const outcomes = await semaphoreMap(
    opts.frames,
    opts.parallelism ?? 5,
    (f) => processFrame(f, { ...ctx, file_id_for: (s) => filesCache.get(s) }),
  );
  const entries: ManifestEntry[] = [];
  const errors: BatchError[] = [];
  const audits: EmittedAudit[] = [];
  for (const o of outcomes) {
    if (o.entry) entries.push(o.entry);
    if (o.error) errors.push(o.error);
    if (o.audit) audits.push(o.audit);
  }
  return { entries, errors, audits };
}

export async function runBatch(opts: BatchOpts): Promise<BatchResult> {
  const stderr = new StreamCapture();
  const telemetry = new Telemetry();
  const batch_id = createHash("sha256")
    .update(opts.frames.map((f) => f.screen_id).join("|"))
    .digest("hex")
    .slice(0, 16);
  const audit_dir = opts.audit_dir ?? DEFAULT_AUDIT_DIR;
  const filesCache = new FileIdCache();
  const ctx: ProcessCtx = {
    provider: opts.provider,
    telemetry,
    stderr,
    retry: resolveRetry(opts.retry),
    temperature: opts.temperature ?? 0,
    model_id: opts.model_id ?? DEFAULT_MODEL,
    audit_dir,
    batch_id,
    mode: opts.mode ?? "auto",
    cache_control_region: opts.cache_control_region,
    structured_output_schema: opts.structured_output_schema,
    validator_binary: opts.validator_binary,
    project_brief: opts.project_brief,
  };

  const lane: Lane = opts.lane ?? "realtime";
  let entries: ManifestEntry[] = [];
  let errors: BatchError[] = [];
  let audits: EmittedAudit[] = [];
  let batch_id_provider: string | undefined;

  if (lane === "batch") {
    const client = opts.batch_client ?? (opts.provider as unknown as { client?: unknown }).client;
    if (!client) {
      throw new Error("--batch lane requires a provider with .client (AnthropicClaudeAdapter or test stub)");
    }
    const lr = await runBatchLane({
      client: client as never,
      frames: opts.frames,
      telemetry,
      stderr,
      temperature: opts.temperature ?? 0,
      model_id: opts.model_id ?? DEFAULT_MODEL,
      audit_dir,
      batch_id,
      cache_control_region: opts.cache_control_region,
      structured_output_schema: opts.structured_output_schema,
      validator_binary: opts.validator_binary,
      provider_sdk_version: opts.provider_sdk_version ?? "unknown",
      project_brief: opts.project_brief,
    });
    entries = lr.entries;
    errors = lr.errors;
    audits = lr.audits;
    batch_id_provider = lr.batch_id_provider;
  } else {
    const r = await runRealtime(opts, ctx, filesCache);
    entries = r.entries;
    errors = r.errors;
    audits = r.audits;
  }
  filesCache.persist(audit_dir, batch_id);

  const manifest = buildManifest(entries, telemetry, opts);
  mkdirSync(dirname(opts.output), { recursive: true });
  writeFileSync(opts.output, JSON.stringify(manifest, null, 2), "utf-8");
  const exit_code = errors.length === 0 ? 0 : 1;
  const summary = computeAggregateSummary(audits, filesCache.getDedupCount());
  const summaryLine = formatAggregateSummary(summary);
  const stdout =
    `RESULT pass=${entries.length} fail=${errors.length} total=${entries.length + errors.length}\n` +
    `${summaryLine}\n`;
  return {
    exit_code,
    stderr: stderr.text(),
    stdout,
    audit_entries: audits,
    errors,
    batch_id_provider,
  };
}
