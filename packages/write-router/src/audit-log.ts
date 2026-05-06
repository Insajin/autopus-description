// SPEC-FIGMA-004 audit log writer (REQ-11, REQ-NFR-05, INV-009).
// Three persisted entry shapes, each strictly key-validated:
//
//   AuditSuccessEntry      (AC-S10, AC-S6) — exactly 5 keys, NO status/reason
//   AuditRejectionEntry    (AC-S5)         — 5 base + status + reason       (7 keys)
//   AuditSkippedEntry      (AC-S1)         — 5 base + status + reason       (7 keys)
//   AuditFallbackEntry     (AC-S7)         — 5 base + fallback_reason +
//                                            fallback_via                   (7 keys)
//
// Token redaction (REQ-13 / INV-007) is applied to every persisted shape
// before the JSON line is appended.

import { appendFile } from "node:fs/promises";
import type { WriteTarget } from "./types.js";
import { redactObject } from "./redactor.js";

export const SUCCESS_KEYS = [
  "frame_id",
  "manifest_entry_hash",
  "pm_identity_or_unknown",
  "timestamp_iso",
  "write_target",
] as const;

export const REJECTION_KEYS = [...SUCCESS_KEYS, "status", "reason"] as const;
export const SKIPPED_KEYS = [...SUCCESS_KEYS, "status", "reason"] as const;
export const FALLBACK_KEYS = [
  ...SUCCESS_KEYS,
  "fallback_reason",
  "fallback_via",
] as const;

export const FALLBACK_LITERAL = "FALLBACK_VIA_PLUGIN_BRIDGE";

export interface AuditBaseFields {
  frame_id: string;
  write_target: WriteTarget | string;
  timestamp_iso: string;
  pm_identity_or_unknown: string;
  manifest_entry_hash: string;
}

export type AuditSuccessEntry = AuditBaseFields;

export interface AuditRejectionEntry extends AuditBaseFields {
  status: "rejected";
  reason: string;
}

export interface AuditSkippedEntry extends AuditBaseFields {
  status: "skipped";
  reason: string;
}

export interface AuditFallbackEntry extends AuditBaseFields {
  fallback_reason: string;
  fallback_via: typeof FALLBACK_LITERAL;
}

export type AuditEntry =
  | AuditSuccessEntry
  | AuditRejectionEntry
  | AuditSkippedEntry
  | AuditFallbackEntry;

export interface AppendOptions {
  logPath?: string;
}

function resolveLogPath(opts?: AppendOptions): string {
  return opts?.logPath ?? process.env.AUDIT_LOG_PATH ?? "./audit.log";
}

function assertExactKeys(entry: object, want: readonly string[]): void {
  const got = Object.keys(entry).sort();
  const wantSorted = [...want].sort();
  if (
    got.length !== wantSorted.length ||
    got.some((k, i) => k !== wantSorted[i])
  ) {
    throw new Error(
      `audit entry must contain exactly [${wantSorted.join(", ")}]; got [${got.join(", ")}]`,
    );
  }
}

async function writeJsonLine(
  entry: object,
  options: AppendOptions | undefined,
): Promise<void> {
  const redacted = redactObject(entry);
  const line = JSON.stringify(redacted) + "\n";
  await appendFile(resolveLogPath(options), line, { encoding: "utf8" });
}

export async function appendAuditSuccess(
  entry: AuditSuccessEntry,
  options?: AppendOptions,
): Promise<void> {
  assertExactKeys(entry, SUCCESS_KEYS);
  await writeJsonLine(entry, options);
}

export async function appendAuditRejection(
  entry: AuditRejectionEntry,
  options?: AppendOptions,
): Promise<void> {
  assertExactKeys(entry, REJECTION_KEYS);
  if (entry.status !== "rejected") {
    throw new Error(`rejection entry must have status='rejected'`);
  }
  await writeJsonLine(entry, options);
}

export async function appendAuditSkipped(
  entry: AuditSkippedEntry,
  options?: AppendOptions,
): Promise<void> {
  assertExactKeys(entry, SKIPPED_KEYS);
  if (entry.status !== "skipped") {
    throw new Error(`skipped entry must have status='skipped'`);
  }
  await writeJsonLine(entry, options);
}

export async function appendAuditFallback(
  entry: AuditFallbackEntry,
  options?: AppendOptions,
): Promise<void> {
  assertExactKeys(entry, FALLBACK_KEYS);
  if (entry.fallback_via !== FALLBACK_LITERAL) {
    throw new Error(
      `fallback entry must have fallback_via='${FALLBACK_LITERAL}'`,
    );
  }
  await writeJsonLine(entry, options);
}

// Dispatcher: chooses the right strict-shape writer by inspecting the entry.
export async function appendAuditEntry(
  entry: AuditEntry,
  options?: AppendOptions,
): Promise<void> {
  const e = entry as unknown as Record<string, unknown>;
  if (e.fallback_via === FALLBACK_LITERAL) {
    return appendAuditFallback(entry as AuditFallbackEntry, options);
  }
  if (e.status === "rejected") {
    return appendAuditRejection(entry as AuditRejectionEntry, options);
  }
  if (e.status === "skipped") {
    return appendAuditSkipped(entry as AuditSkippedEntry, options);
  }
  return appendAuditSuccess(entry as AuditSuccessEntry, options);
}

// Legacy export retained for compatibility with the existing W1 test surface.
export const AUDIT_KEYS = SUCCESS_KEYS;

export function buildAuditEntry(input: AuditSuccessEntry): AuditSuccessEntry {
  assertExactKeys(input, SUCCESS_KEYS);
  return { ...input };
}
