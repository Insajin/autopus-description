// SPEC-FIGMA-016 — P2 state primitives: durable batch handles, mode override,
// tunnel URL redaction. Kept separate from `mcp-p2-handlers.ts` so the handler
// dispatcher stays under the 300-line file limit.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

/**
 * Redact a tunnel URL per SPEC-FIGMA-008. Keeps host suffix but strips the
 * random subdomain (session identifier) and any path/query. Returns null when
 * input is null so callers can wire daemon state directly.
 */
export function redactTunnelUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const tail = url.hostname.split(".").slice(-2).join(".");
    return `${url.protocol}//<redacted>.${tail}`;
  } catch {
    return "<redacted>";
  }
}

export interface BatchHandle {
  readonly batch_id: string;
  readonly submitted_at: string;
  readonly expected_completion: string;
  readonly state: "in_progress" | "completed" | "failed";
  readonly node_ids: readonly string[];
  readonly error?: string;
}

export interface BatchStore {
  submit(input: { file_id: string; node_ids: string[] }): BatchHandle;
  get(batchId: string): BatchHandle | null;
}

/**
 * Durable batch store backed by `.autopus/batch/<batch_id>.json` so handles
 * survive daemon restart (INV-BATCH-DURABILITY).
 */
export class FileBatchStore implements BatchStore {
  constructor(private readonly batchDir: string) {
    mkdirSync(this.batchDir, { recursive: true });
  }
  submit(input: { file_id: string; node_ids: string[] }): BatchHandle {
    const batch_id = `bat_${randomBytes(6).toString("hex")}`;
    const handle: BatchHandle = {
      batch_id,
      submitted_at: new Date().toISOString(),
      expected_completion: new Date(Date.now() + 86_400_000).toISOString(),
      state: "in_progress",
      node_ids: input.node_ids,
    };
    writeFileSync(
      resolve(this.batchDir, `${batch_id}.json`),
      JSON.stringify(handle),
      "utf8",
    );
    return handle;
  }
  get(batchId: string): BatchHandle | null {
    const path = resolve(this.batchDir, `${batchId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as BatchHandle;
    } catch {
      return null;
    }
  }
}

export interface ModeState {
  active_mode: "auto" | "node-only" | "vision-only";
  source: "default" | "forced";
}

/**
 * Session-scoped generation-mode override (INV-MODE-SESSION). Daemon restart
 * resets to default `auto`.
 */
export class ModeOverride {
  private state: ModeState = { active_mode: "auto", source: "default" };
  get(): ModeState {
    return { ...this.state };
  }
  set(mode: "auto" | "node-only" | "vision-only"): ModeState {
    this.state = { active_mode: mode, source: "forced" };
    return this.get();
  }
  clear(): ModeState {
    this.state = { active_mode: "auto", source: "default" };
    return this.get();
  }
}

export interface DaemonStatusSource {
  version: string;
  startedAt: Date;
  transport: "stdio" | "http";
  tunnelUrl: string | null;
  pendingCount: () => number;
  appliedCount: () => number;
  auditRowCount: () => number;
  lastInitializeAt: () => string | null;
}
