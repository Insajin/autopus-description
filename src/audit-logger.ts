import { redact, redactJsonValue } from "./token-redactor.js";

/**
 * SPEC-FIGMA-002 REQ-22: per-frame JSON Lines audit logger.
 *
 * INV-008: each entry's key set is exactly
 *   {frame_id, started_at, finished_at, retries, bytes_transferred, status}.
 * Status enum: ok | retry_exhausted | payload_oversize | skipped.
 * All output passes through token redactor before emit.
 */

export type AuditStatus = "ok" | "retry_exhausted" | "payload_oversize" | "skipped";

// @AX:NOTE:[AUTO] — REQ-22 / INV-008 exact key set locked by AC-S8 oracle (Object.keys(entry).sort() set equality). Adding a key — even a benign telemetry field — fails AC-S8.
export const AUDIT_KEYS: readonly string[] = [
  "bytes_transferred",
  "finished_at",
  "frame_id",
  "retries",
  "started_at",
  "status",
];

export interface AuditEntry {
  readonly frame_id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly retries: number;
  readonly bytes_transferred: number;
  readonly status: AuditStatus;
}

export interface AuditSink {
  write(line: string): void;
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export class AuditLogger {
  private readonly sink: AuditSink;

  constructor(sink: AuditSink) {
    this.sink = sink;
  }

  log(entry: AuditEntry): void {
    assertEntryShape(entry);
    // Defense-in-depth (A09): redact each string field BEFORE serialization so any
    // `\u`-escape that JSON.stringify might emit cannot mask a token. The post-
    // serialization redact() call below is kept as a belt-and-suspenders pass —
    // the primary control remains the assertEntryShape key-set lock (INV-008),
    // which prevents any string field carrying a token from being introduced.
    const obj: Record<string, unknown> = redactJsonValue({
      bytes_transferred: entry.bytes_transferred,
      finished_at: entry.finished_at,
      frame_id: entry.frame_id,
      retries: entry.retries,
      started_at: entry.started_at,
      status: entry.status,
    });
    const line = JSON.stringify(obj);
    this.sink.write(redact(line) + "\n");
  }
}

function assertEntryShape(entry: AuditEntry): void {
  const keys = Object.keys(entry).sort();
  if (keys.length !== AUDIT_KEYS.length || keys.some((k, i) => k !== AUDIT_KEYS[i])) {
    throw new Error(`audit entry key set mismatch: got [${keys.join(",")}]`);
  }
  if (!ISO_8601.test(entry.started_at)) {
    throw new Error(`started_at must be ISO-8601 UTC: ${entry.started_at}`);
  }
  if (!ISO_8601.test(entry.finished_at)) {
    throw new Error(`finished_at must be ISO-8601 UTC: ${entry.finished_at}`);
  }
  const allowed: AuditStatus[] = ["ok", "retry_exhausted", "payload_oversize", "skipped"];
  if (!allowed.includes(entry.status)) {
    throw new Error(`invalid status: ${entry.status}`);
  }
  if (!Number.isFinite(entry.retries) || entry.retries < 0) {
    throw new Error(`retries must be non-negative finite: ${entry.retries}`);
  }
  if (!Number.isFinite(entry.bytes_transferred) || entry.bytes_transferred < 0) {
    throw new Error(`bytes_transferred must be non-negative finite: ${entry.bytes_transferred}`);
  }
}

export function nowIso(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

export class BufferSink implements AuditSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  toJsonl(): string {
    return this.lines.join("");
  }
}
