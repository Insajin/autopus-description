// SPEC-FIGMA-003 audit emitter (REQ-NFR-03 / REQ-24).
// Writes per-call JSONL records with prompt/response SHA-256 hashes.
// Raw text retention is OFF by default; debug mode (env DEBUG=true) retains
// raw text under .audit/<batch-id>/raw/ so it can be excluded via .gitignore.
//
// SPEC-FIGMA-002's src/audit-logger.ts is intentionally NOT reused: its
// AC-S8 oracle locks an exact 6-key set; adding hash fields would break
// that contract.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export interface AuditRecord {
  batch_id: string;
  screen_id: string;
  provider: string;
  mode: "node-only" | "vision";
  input_tokens: number;
  output_tokens: number;
  // Optional T-PI hook: true when ≥1 untrusted text block was wrapped.
  untrusted_text_processed?: boolean;
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

export function buildAuditRecord(input: EmitInput): EmittedAudit {
  return {
    batch_id: input.batch_id,
    screen_id: input.screen_id,
    provider: input.provider,
    mode: input.mode,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    untrusted_text_processed: input.untrusted_text_processed,
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
