// SPEC-FIGMA-007 REQ-12, REQ-14, REQ-08, REQ-19, REQ-15 — daemon-side write
// audit row writers. Strict key-set shapes asserted by AC-S5/S4/S6/S8/S9.
//
// All writers route through `redactObject` from packages/write-router/src/redactor.ts
// (frozen) before the row is appended (NFR-03) — additive use only.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactObject } from "../../packages/write-router/src/redactor.js";

export const DRIFT_ABORT_KEYS = [
  "frame_id",
  "manifest_entry_hash",
  "pm_identity_or_unknown",
  "reason",
  "source_hash_dryrun",
  "source_hash_recomputed",
  "status",
  "timestamp_iso",
  "write_target",
] as const;

export const REJECTION_KEYS_7 = [
  "frame_id",
  "manifest_entry_hash",
  "pm_identity_or_unknown",
  "reason",
  "status",
  "timestamp_iso",
  "write_target",
] as const;

export const UNDO_KEYS = REJECTION_KEYS_7;
export const SUCCESS_KEYS_5 = [
  "frame_id",
  "manifest_entry_hash",
  "pm_identity_or_unknown",
  "timestamp_iso",
  "write_target",
] as const;

export interface WriteAuditWriterOptions {
  logPath?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function appendLine(row: Record<string, unknown>, opts: WriteAuditWriterOptions): void {
  if (!opts.logPath) return;
  const dir = dirname(opts.logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const safe = redactObject(row);
  appendFileSync(opts.logPath, JSON.stringify(safe) + "\n", "utf8");
}

export interface DriftAbortInput {
  frame_id: string;
  manifest_entry_hash: string;
  pm_identity_or_unknown: string;
  write_target: string;
  source_hash_dryrun: string;
  source_hash_recomputed: string;
}

export function buildDriftAbortRow(input: DriftAbortInput): Record<string, unknown> {
  return {
    frame_id: input.frame_id,
    manifest_entry_hash: input.manifest_entry_hash,
    pm_identity_or_unknown: input.pm_identity_or_unknown,
    reason: "APPLY_DRIFT_ABORT",
    source_hash_dryrun: input.source_hash_dryrun,
    source_hash_recomputed: input.source_hash_recomputed,
    status: "rejected",
    timestamp_iso: nowIso(),
    write_target: input.write_target,
  };
}

export async function appendAuditDriftAbort(
  input: DriftAbortInput,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  const row = buildDriftAbortRow(input);
  appendLine(row, opts);
  return row;
}

export interface RejectionInput {
  frame_id: string;
  manifest_entry_hash: string;
  pm_identity_or_unknown: string;
  write_target: string;
  reason: string;
}

export function buildRejectionRow(input: RejectionInput): Record<string, unknown> {
  return {
    frame_id: input.frame_id,
    manifest_entry_hash: input.manifest_entry_hash,
    pm_identity_or_unknown: input.pm_identity_or_unknown,
    reason: input.reason,
    status: "rejected",
    timestamp_iso: nowIso(),
    write_target: input.write_target,
  };
}

export async function appendAuditRejection(
  input: RejectionInput,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  const row = buildRejectionRow(input);
  appendLine(row, opts);
  return row;
}

export async function appendAuditPartialDisconnect(
  input: Omit<RejectionInput, "reason">,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  return appendAuditRejection({ ...input, reason: "APPLY_PARTIAL_DISCONNECT" }, opts);
}

export async function appendAuditMissingGate(
  input: Omit<RejectionInput, "reason">,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  return appendAuditRejection({ ...input, reason: "MISSING_DRYRUN_GATE" }, opts);
}

export async function appendAuditPendingExpired(
  input: Omit<RejectionInput, "reason">,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  return appendAuditRejection({ ...input, reason: "PENDING_EXPIRED" }, opts);
}

export interface UndoAuditInput {
  frame_id: string;
  manifest_entry_hash: string;
  pm_identity_or_unknown: string;
  write_target: string;
}

export function buildUndoRow(input: UndoAuditInput): Record<string, unknown> {
  return {
    frame_id: input.frame_id,
    manifest_entry_hash: input.manifest_entry_hash,
    pm_identity_or_unknown: input.pm_identity_or_unknown,
    reason: "UNDO_REQUESTED",
    status: "undone",
    timestamp_iso: nowIso(),
    write_target: input.write_target,
  };
}

export async function appendAuditUndo(
  input: UndoAuditInput,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  const row = buildUndoRow(input);
  appendLine(row, opts);
  return row;
}

export interface SuccessInput {
  frame_id: string;
  manifest_entry_hash: string;
  pm_identity_or_unknown: string;
  write_target: string;
}

export function buildSuccessRow(input: SuccessInput): Record<string, unknown> {
  return {
    frame_id: input.frame_id,
    manifest_entry_hash: input.manifest_entry_hash,
    pm_identity_or_unknown: input.pm_identity_or_unknown,
    timestamp_iso: nowIso(),
    write_target: input.write_target,
  };
}

export async function appendAuditSuccess(
  input: SuccessInput,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  const row = buildSuccessRow(input);
  appendLine(row, opts);
  return row;
}

export interface SkippedInput extends Omit<RejectionInput, "reason"> {}

export async function appendAuditSkipped(
  input: SkippedInput,
  opts: WriteAuditWriterOptions = {},
): Promise<Record<string, unknown>> {
  const row = {
    frame_id: input.frame_id,
    manifest_entry_hash: input.manifest_entry_hash,
    pm_identity_or_unknown: input.pm_identity_or_unknown,
    reason: "IDEMPOTENT_SKIP",
    status: "skipped",
    timestamp_iso: nowIso(),
    write_target: input.write_target,
  };
  appendLine(row, opts);
  return row;
}
