// SPEC-FIGMA-006 daemon audit writer. Wraps the frozen `buildAuditRecord`
// from src/audit-emitter.ts to write rows into a single
// `<auditDir>/audit.jsonl` file (one-line JSON), preserving the 16-key
// EmittedAudit shape (NFR-04). Every persisted byte passes through `redact`
// to satisfy INV-006.
//
// @AX:WARN: [AUTO] EmittedAudit 16-key shape is invariant (NFR-04). Daemon
// adds new event types (`client_profile_attached`, `daemon_recovered_from_crash`)
// but MUST keep this 16-field row schema. Adding fields here breaks downstream
// audit consumers and violates the SPEC-FIGMA-003 contract.
// @AX:REASON: NFR-04 — daemon may not modify src/audit-emitter.ts; this writer
// is the only daemon-side adapter and is the choke point for schema invariance.
//
// @AX:WARN: [AUTO] Every appended JSONL row MUST flow through `redact` before
// reaching disk (INV-006: zero figd_ leak in any persisted artifact).
// @AX:REASON: NFR-03 / Q-SEC-02 — daemon handles untrusted Figma payloads
// containing potentially leaked tokens; redaction at this boundary is the last
// line of defense before persistence.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { buildAuditRecord, type EmitInput, type EmittedAudit } from "../audit-emitter.js";
import * as tokenRedactor from "../token-redactor.js";

export const REQUIRED_AUDIT_FIELDS = [
  "batch_id",
  "screen_id",
  "provider",
  "mode",
  "input_tokens",
  "output_tokens",
  "cache_hit",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "dynamic_input_tokens",
  "file_id",
  "batch_id_provider",
  "strict_mode_used",
  "provider_sdk_version",
  "prompt_sha256",
  "response_sha256",
  "ts",
];

export interface DaemonAuditWriterOptions {
  auditDir: string;
  provider: string;
}

export class DaemonAuditWriter {
  private readonly auditDir: string;
  private readonly auditFile: string;
  private readonly provider: string;
  private seq = 0;
  readonly records: EmittedAudit[] = [];

  constructor(opts: DaemonAuditWriterOptions) {
    this.auditDir = opts.auditDir;
    this.auditFile = join(opts.auditDir, "audit.jsonl");
    this.provider = opts.provider;
  }

  /** Emit a normal audit row from a {prompt_text, response_text} pair. */
  emit(input: { prompt_text: string; response_text: string }): EmittedAudit {
    const seq = this.seq++;
    const emitInput: EmitInput = {
      batch_id: `daemon-${seq}`,
      screen_id: "FRAME-01",
      provider: this.provider,
      mode: "node-only",
      input_tokens: 0,
      output_tokens: 0,
      cache_hit: false,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      dynamic_input_tokens: 0,
      file_id: null,
      batch_id_provider: null,
      strict_mode_used: false,
      provider_sdk_version: "0.0.0",
      prompt_text: input.prompt_text,
      response_text: input.response_text,
    };
    const record = buildAuditRecord(emitInput);
    this.records.push(record);
    this.appendLine(record);
    return record;
  }

  /**
   * Emit a daemon-namespaced event row (e.g. client_profile_attached,
   * daemon_recovered_from_crash). Reuses the 16-key field set; additional
   * keys live alongside but the canonical fields are still present.
   */
  emitEvent(extra: Record<string, unknown>): void {
    const base: Record<string, unknown> = {};
    for (const k of REQUIRED_AUDIT_FIELDS) {
      switch (k) {
        case "input_tokens":
        case "output_tokens":
        case "cache_read_input_tokens":
        case "cache_creation_input_tokens":
        case "dynamic_input_tokens":
          base[k] = 0;
          break;
        case "cache_hit":
        case "strict_mode_used":
          base[k] = false;
          break;
        case "file_id":
        case "batch_id_provider":
          base[k] = null;
          break;
        case "ts":
          base[k] = new Date().toISOString();
          break;
        default:
          base[k] = "";
      }
    }
    base.batch_id = `daemon-event-${this.seq++}`;
    base.provider = this.provider;
    base.mode = "node-only";
    base.provider_sdk_version = "0.0.0";
    Object.assign(base, extra);
    this.appendLine(base);
  }

  private appendLine(row: Record<string, unknown> | EmittedAudit): void {
    if (!existsSync(this.auditDir)) mkdirSync(this.auditDir, { recursive: true });
    const safe = tokenRedactor.redact(JSON.stringify(row));
    appendFileSync(this.auditFile, safe + "\n", "utf8");
  }
}
