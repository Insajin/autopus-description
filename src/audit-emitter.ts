// SPEC-FIGMA-003 audit emitter (REQ-NFR-03 / REQ-24).
// Writes per-call JSONL records with prompt/response SHA-256 hashes.
// Raw text retention is OFF by default; debug mode (env DEBUG=true) retains
// raw text under .audit/<batch-id>/raw/ so it can be excluded via .gitignore.
//
// SPEC-FIGMA-002's src/audit-logger.ts is intentionally NOT reused: its
// AC-S8 oracle locks an exact 6-key set; adding hash fields would break
// that contract.
//
// SPEC-FIGMA-005 REQ-08, REQ-NFR-07: 8 additive audit fields capture
// Prompt Caching split, Files API file_id, Message Batches batch_id_provider,
// Structured Outputs strict_mode_used, and provider_sdk_version. Every
// string field on the emitted record is passed through src/token-redactor.ts
// before write so figd_ token leakage is masked at the audit boundary.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { redact } from "./token-redactor.js";

export interface AuditRecord {
  batch_id: string;
  screen_id: string;
  provider: string;
  mode: "node-only" | "vision";
  input_tokens: number;
  output_tokens: number;
  // Optional T-PI hook: true when ≥1 untrusted text block was wrapped.
  untrusted_text_processed?: boolean;
  // SPEC-FIGMA-005 REQ-08: Prompt Caching observability per frame.
  cache_hit: boolean;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  dynamic_input_tokens: number;
  // SPEC-FIGMA-005 REQ-04, REQ-08: Files API + Message Batches transient ids.
  // file_id null when mode === "node-only" or Vision used inline base64.
  // batch_id_provider null when --realtime mode (no Batches API call).
  file_id: string | null;
  batch_id_provider: string | null;
  // SPEC-FIGMA-005 REQ-02, REQ-08: Structured Outputs strict mode flag.
  strict_mode_used: boolean;
  // SPEC-FIGMA-005 REQ-08: SDK version for forensic uniqueness; redacted
  // through token redactor in case version string contains figd_ test fixture.
  provider_sdk_version: string;
}

export interface EmitInput extends AuditRecord {
  prompt_text: string;
  response_text: string;
}

export interface EmittedAudit extends AuditRecord {
  prompt_sha256: string;
  response_sha256: string;
  ts: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isDebug(): boolean {
  return process.env.DEBUG === "true" || process.env.DEBUG === "1";
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

// Per REQ-NFR-07 the redactor scope is figd_ tokens only (Figma personal
// access tokens, locked by SPEC-FIGMA-002 AC-S3 oracle). xoxb/bearer/etc
// are intentionally out of scope and tracked separately.
function redactNullable(value: string | null): string | null {
  return value === null ? null : redact(value);
}

export function buildAuditRecord(input: EmitInput): EmittedAudit {
  return {
    batch_id: input.batch_id,
    screen_id: input.screen_id,
    provider: input.provider,
    mode: input.mode,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    untrusted_text_processed: input.untrusted_text_processed,
    cache_hit: input.cache_hit,
    cache_read_input_tokens: input.cache_read_input_tokens,
    cache_creation_input_tokens: input.cache_creation_input_tokens,
    dynamic_input_tokens: input.dynamic_input_tokens,
    file_id: redactNullable(input.file_id),
    batch_id_provider: redactNullable(input.batch_id_provider),
    strict_mode_used: input.strict_mode_used,
    provider_sdk_version: redact(input.provider_sdk_version),
    prompt_sha256: sha256(input.prompt_text),
    response_sha256: sha256(input.response_text),
    ts: new Date().toISOString(),
  };
}

export function emitAuditRecord(
  input: EmitInput,
  audit_dir?: string,
): EmittedAudit {
  const record = buildAuditRecord(input);
  if (audit_dir) {
    const batchDir = join(audit_dir, input.batch_id);
    ensureDir(batchDir);
    const callsPath = join(batchDir, "calls.jsonl");
    appendFileSync(callsPath, JSON.stringify(record) + "\n", "utf-8");
    if (isDebug()) {
      const rawDir = join(batchDir, "raw");
      ensureDir(rawDir);
      writeFileSync(
        join(rawDir, `${input.screen_id}.${input.mode}.json`),
        JSON.stringify({
          prompt_text: input.prompt_text,
          response_text: input.response_text,
        }),
        "utf-8",
      );
    }
  }
  return record;
}

// SPEC-FIGMA-005 REQ-22: aggregate summary builder. Reads the per-frame
// audit records and computes the run-level rollup printed to stdout at the
// end of generate-descriptions invocation.
export interface AggregateSummary {
  aggregate_cache_hit_ratio: number;
  aggregate_dynamic_input_tokens: number;
  aggregate_cached_input_tokens: number;
  aggregate_files_api_dedup_count: number;
  provider_sdk_version: string;
}

export function computeAggregateSummary(
  audits: EmittedAudit[],
  files_api_dedup_count: number,
): AggregateSummary {
  let read = 0;
  let creation = 0;
  let dynamic = 0;
  let sdkVersion = "";
  for (const a of audits) {
    read += a.cache_read_input_tokens;
    creation += a.cache_creation_input_tokens;
    dynamic += a.dynamic_input_tokens;
    if (!sdkVersion) sdkVersion = a.provider_sdk_version;
  }
  const total = read + creation + dynamic;
  const ratio = total === 0 ? 0 : read / total;
  return {
    aggregate_cache_hit_ratio: ratio,
    aggregate_dynamic_input_tokens: dynamic,
    aggregate_cached_input_tokens: read + creation,
    aggregate_files_api_dedup_count: files_api_dedup_count,
    provider_sdk_version: sdkVersion,
  };
}

export function formatAggregateSummary(s: AggregateSummary): string {
  return [
    `aggregate_cache_hit_ratio=${s.aggregate_cache_hit_ratio.toFixed(5)}`,
    `aggregate_cached_input_tokens=${s.aggregate_cached_input_tokens}`,
    `aggregate_dynamic_input_tokens=${s.aggregate_dynamic_input_tokens}`,
    `aggregate_files_api_dedup_count=${s.aggregate_files_api_dedup_count}`,
    `provider_sdk_version=${s.provider_sdk_version}`,
  ].join(" ");
}
