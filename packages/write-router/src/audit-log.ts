// SPEC-FIGMA-004 audit log writer (REQ-11, REQ-NFR-05, INV-009).
// Exactly 5 keys per JSONL record. Token redaction applied before write.

import { appendFile } from "node:fs/promises";
import type { WriteTarget } from "./types.js";
import { redactObject } from "./redactor.js";

export const AUDIT_KEYS = [
  "frame_id",
  "manifest_entry_hash",
  "pm_identity_or_unknown",
  "timestamp_iso",
  "write_target",
] as const;

export interface AuditEntry {
  frame_id: string;
  write_target: WriteTarget | string;
  timestamp_iso: string;
  pm_identity_or_unknown: string;
  manifest_entry_hash: string;
}

export interface AppendOptions {
  logPath?: string;
}

function resolveLogPath(opts?: AppendOptions): string {
  return (
    opts?.logPath ?? process.env.AUDIT_LOG_PATH ?? "./audit.log"
  );
}

function assertExactKeys(entry: AuditEntry): void {
  const got = Object.keys(entry).sort();
  const want = [...AUDIT_KEYS].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    throw new Error(
      `audit entry must contain exactly ${want.length} keys [${want.join(", ")}]; ` +
        `got [${got.join(", ")}]`,
    );
  }
}

export async function appendAuditEntry(
  entry: AuditEntry,
  options?: AppendOptions,
): Promise<void> {
  assertExactKeys(entry);
  const redacted = redactObject(entry) as AuditEntry;
  const line = JSON.stringify(redacted) + "\n";
  await appendFile(resolveLogPath(options), line, { encoding: "utf8" });
}

export function buildAuditEntry(input: AuditEntry): AuditEntry {
  assertExactKeys(input);
  return { ...input };
}
