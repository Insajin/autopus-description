import { canonicalJson as canonicalJsonImpl, type CanonicalValue } from "./source-hash.js";

/**
 * SPEC-FIGMA-002 idempotency / substitutability test helpers.
 *
 * AC-S6: strip volatile timestamp fields (frames[].extraction_started_at,
 *   frames[].extraction_finished_at, pilot_metadata.pilot_date) before
 *   comparing two runs byte-by-byte.
 */

const VOLATILE_FRAME_FIELDS: ReadonlySet<string> = new Set([
  "extraction_started_at",
  "extraction_finished_at",
]);
const VOLATILE_HEADER_FIELDS: ReadonlySet<string> = new Set(["pilot_date"]);

export interface ManifestLike {
  readonly schema_version: string;
  readonly pilot_metadata: Record<string, unknown>;
  readonly frames: ReadonlyArray<Record<string, unknown>>;
  readonly prototype?: unknown;
}

export interface StrippedManifest {
  readonly schema_version: string;
  readonly pilot_metadata: Record<string, unknown>;
  readonly frames: ReadonlyArray<Record<string, unknown>>;
  readonly prototype?: unknown;
}

export function stripVolatileTimestamps(m: ManifestLike): StrippedManifest {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m.pilot_metadata)) {
    if (!VOLATILE_HEADER_FIELDS.has(k)) meta[k] = v;
  }
  const frames = m.frames.map((f) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      if (!VOLATILE_FRAME_FIELDS.has(k)) out[k] = v;
    }
    return out;
  });
  return {
    schema_version: m.schema_version,
    pilot_metadata: meta,
    frames,
    prototype: m.prototype,
  };
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonImpl(value as CanonicalValue);
}
