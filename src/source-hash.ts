import { createHash } from "node:crypto";

/**
 * SPEC-FIGMA-002 REQ-05: deterministic source_hash computation.
 *
 * canonical_json: keys sorted lexicographically at every depth, no whitespace,
 * integers as bare JSON numbers, UTF-8 string encoding, no trailing newline.
 * Output: 64-char lowercase hex SHA-256 (matches FIGMA-001 REQ-06 pattern).
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<CanonicalValue>
  | { readonly [k: string]: CanonicalValue };

// @AX:ANCHOR:[AUTO]:fan-in=4 — REQ-05 canonicalization gate; AC-S1/S2 oracle hashes lock this behavior
// @AX:REASON: callers — computeSourceHash (this file), src/manifest-utils.ts, src/manifest-writer.ts, src/read-pipeline.ts. Any change to key sort, whitespace, or integer rendering breaks AC-S1 (014ed33c...b420) and AC-S2 (4d37393b...7b11) byte-for-byte.
export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonicalJson(v as CanonicalValue));
    return `[${parts.join(",")}]`;
  }
  const obj = value as { readonly [k: string]: CanonicalValue };
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(",")}}`;
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`canonicalJson: non-finite number ${String(n)} not representable`);
  }
  if (Number.isInteger(n)) return n.toString(10);
  return JSON.stringify(n);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  const h = createHash("sha256");
  h.update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes));
  return h.digest("hex");
}

export interface SourceHashInput {
  readonly node_tree_summary: CanonicalValue;
  readonly image_bytes: Uint8Array;
}

// @AX:ANCHOR:[AUTO]:fan-in=3 — REQ-05 source_hash gate; locked by AC-S1/S2 oracles
// @AX:REASON: callers — src/pipeline.ts, src/read-pipeline.ts, tests/source-hash.test.ts. Output MUST be 64-char lowercase hex matching FIGMA-001 REQ-06 pattern ^[a-f0-9]{8,128}$.
export function computeSourceHash(input: SourceHashInput): string {
  const imageHash = sha256Hex(input.image_bytes);
  const canonical = canonicalJson({
    image_bytes_sha256: imageHash,
    node_tree_summary: input.node_tree_summary,
  });
  return sha256Hex(canonical);
}

export function imageBytesSha256(image: Uint8Array): string {
  return sha256Hex(image);
}
