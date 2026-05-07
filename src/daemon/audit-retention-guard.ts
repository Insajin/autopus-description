// SPEC-FIGMA-007 REQ-10, NFR-03 — daemon-side audit retention guard.
//
// Frozen `src/audit-emitter.ts::emitAuditRecord` writes raw `prompt_text` and
// `response_text` to `.audit/<batch_id>/raw/<screen_id>.<mode>.json` under
// `DEBUG=true`. Frozen `src/token-redactor.ts::redact` only strips figd_*.
// The retention guard is the additive outer layer that strips xoxb-, bearer,
// and absolute privileged path segments BEFORE the raw file lands on disk.
//
// Strategy: replicate the frozen path's two write sites (calls.jsonl + raw)
// using the frozen `buildAuditRecord` (export, NFR-04 preserved). The
// EmittedAudit `prompt_sha256` is computed by the frozen builder over the
// ORIGINAL prompt_text so the SPEC-FIGMA-006 INV-003 chain extends without
// break. Only the raw file content is redacted via `redactExtended`.

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildAuditRecord,
  type EmitInput,
  type EmittedAudit,
} from "../audit-emitter.js";
import { redactExtended } from "./redact-extended.js";

const DEFAULT_PROVIDER = "autopus-daemon";
const DEFAULT_MODE: EmitInput["mode"] = "node-only";

function isDebug(): boolean {
  return process.env.DEBUG === "true" || process.env.DEBUG === "1";
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export interface RetentionGuardInput {
  batch_id: string;
  screen_id: string;
  mode?: EmitInput["mode"];
  prompt_text: string;
  response_text: string;
  provider?: string;
  provider_sdk_version?: string;
  // Optional pass-through for the SPEC-FIGMA-005 8 fields. Defaulted when omitted
  // so daemon callers don't need to fabricate them per write event.
  input_tokens?: number;
  output_tokens?: number;
  cache_hit?: boolean;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  dynamic_input_tokens?: number;
  file_id?: string | null;
  batch_id_provider?: string | null;
  strict_mode_used?: boolean;
  untrusted_text_processed?: boolean;
}

// SEC-007-M1 — identifier allowlist gate. The retention guard joins
// caller-supplied `batch_id`/`screen_id`/`mode` into filesystem paths
// (`<audit_dir>/<batch_id>/raw/<screen_id>.<mode>.json`). Today's only callers
// pass safe shapes, but this gate prevents path-traversal injection in case
// a future caller forwards untrusted input.
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

function assertSafeIdentifier(name: string, value: string): void {
  // Reject empty, regex-failing, and `..` (the allowlist permits `.` so a
  // bare `..` would otherwise pass).
  if (!value || value === "." || value === ".." || !SAFE_ID.test(value)) {
    throw new Error(
      `audit-retention-guard: identifier shape violation for ${name}=${JSON.stringify(value)}`,
    );
  }
}

function buildEmitInput(input: RetentionGuardInput): EmitInput {
  return {
    batch_id: input.batch_id,
    screen_id: input.screen_id,
    provider: input.provider ?? DEFAULT_PROVIDER,
    mode: input.mode ?? DEFAULT_MODE,
    input_tokens: input.input_tokens ?? 0,
    output_tokens: input.output_tokens ?? 0,
    cache_hit: input.cache_hit ?? false,
    cache_read_input_tokens: input.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: input.cache_creation_input_tokens ?? 0,
    dynamic_input_tokens: input.dynamic_input_tokens ?? 0,
    file_id: input.file_id ?? null,
    batch_id_provider: input.batch_id_provider ?? null,
    strict_mode_used: input.strict_mode_used ?? false,
    provider_sdk_version: input.provider_sdk_version ?? "0.0.0",
    prompt_text: input.prompt_text,
    response_text: input.response_text,
    untrusted_text_processed: input.untrusted_text_processed,
  };
}

/**
 * Emits an audit record, additively replacing the frozen
 * `emitAuditRecord(input, audit_dir)` for daemon write-path events.
 *
 * Behavior:
 *   1. Compute the EmittedAudit via the frozen `buildAuditRecord` so the
 *      `prompt_sha256` chain is preserved byte-for-byte.
 *   2. Append the EmittedAudit JSON line to `<audit_dir>/<batch_id>/calls.jsonl`.
 *   3. If DEBUG=true, write `<audit_dir>/<batch_id>/raw/<screen_id>.<mode>.json`
 *      with the prompt/response text passed through `redactExtended`
 *      (figd_ + xoxb- + bearer + absolute-path scrub) BEFORE persistence.
 *
 * The frozen `src/audit-emitter.ts::emitAuditRecord` is NOT called from this
 * function — it would re-write the raw file with unredacted text under DEBUG.
 */
export async function emitAuditRecordWithRetentionGuard(
  input: RetentionGuardInput,
  audit_dir?: string,
): Promise<EmittedAudit> {
  const emitInput = buildEmitInput(input);
  // SEC-007-M1: validate before any path.join to block traversal injection.
  assertSafeIdentifier("batch_id", emitInput.batch_id);
  assertSafeIdentifier("screen_id", emitInput.screen_id);
  assertSafeIdentifier("mode", emitInput.mode);
  const record = buildAuditRecord(emitInput);
  if (!audit_dir) return record;

  const batchDir = join(audit_dir, emitInput.batch_id);
  ensureDir(batchDir);

  const callsPath = join(batchDir, "calls.jsonl");
  appendFileSync(callsPath, JSON.stringify(record) + "\n", "utf-8");

  if (isDebug()) {
    const rawDir = join(batchDir, "raw");
    ensureDir(rawDir);
    const safePrompt = redactExtended(emitInput.prompt_text);
    const safeResponse = redactExtended(emitInput.response_text);
    writeFileSync(
      join(rawDir, `${emitInput.screen_id}.${emitInput.mode}.json`),
      JSON.stringify({
        prompt_text: safePrompt,
        response_text: safeResponse,
      }),
      "utf-8",
    );
  }
  return record;
}
