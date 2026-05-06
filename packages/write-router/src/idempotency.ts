// SPEC-FIGMA-004 idempotency dedup (REQ-07, REQ-NFR-01, INV-001).
// PRD § 11 Q4: hash includes PM-facing fields + write_target.
// Excluded: confidence, pilot_metadata, token_usage.

import { createHash } from "node:crypto";
import type { ManifestEntry } from "./types.js";

const EXCLUDED_KEYS = new Set([
  "confidence",
  "pilot_metadata",
  "token_usage",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((k) => !EXCLUDED_KEYS.has(k))
      .sort();
    for (const k of keys) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function computeManifestEntryHash(entry: ManifestEntry): string {
  const canonical = canonicalize(entry);
  const serialized = JSON.stringify(canonical);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

export const computeHash = computeManifestEntryHash;

export class IdempotencyTracker {
  private readonly seen = new Set<string>();

  isDuplicate(hash: string): boolean {
    return this.seen.has(hash);
  }

  record(hash: string): void {
    this.seen.add(hash);
  }

  has(hash: string): boolean {
    return this.seen.has(hash);
  }

  clear(): void {
    this.seen.clear();
  }

  size(): number {
    return this.seen.size;
  }
}
