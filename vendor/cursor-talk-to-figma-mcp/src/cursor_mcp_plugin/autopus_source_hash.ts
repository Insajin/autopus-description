// SPEC-FIGMA-007 REQ-04, NFR-02 — webcrypto port of `src/source-hash.ts`.
// Byte-equivalence proof: tests/unit/plugin-source-hash-port.test.ts oracle
// asserts every output byte-equals the Node `computeSourceHash` for the
// canonical SPEC-FIGMA-002 input + the AC-S5 mutated input + 30-frame mock.
//
// canonical_json contract: keys sorted lexicographically at every depth, no
// whitespace, integers as bare JSON numbers, UTF-8 string encoding, no
// trailing newline. Output: 64-char lowercase hex SHA-256.

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<CanonicalValue>
  | { readonly [k: string]: CanonicalValue };

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonicalJson(v));
    return `[${parts.join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return "null";
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`canonicalJson: non-finite number ${String(n)} not representable`);
  }
  if (Number.isInteger(n)) return n.toString(10);
  return JSON.stringify(n);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const subtle = getSubtle();
  // Wrap in a fresh ArrayBuffer view so the typed-array argument matches the
  // SubtleCrypto.digest BufferSource signature exactly across Node and Figma
  // plugin webcrypto runtimes.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const digest = await subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(digest));
}

async function sha256HexString(text: string): Promise<string> {
  const utf8 = new TextEncoder().encode(text);
  return sha256HexBytes(utf8);
}

function getSubtle(): SubtleCrypto {
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  if (!g.crypto?.subtle) {
    throw new Error("webcrypto subtle not available — plugin runtime mismatch");
  }
  return g.crypto.subtle;
}

export interface SourceHashInput {
  readonly node_tree_summary: unknown;
  readonly image_bytes: Uint8Array;
}

export async function computeSourceHashWebCrypto(
  input: SourceHashInput,
): Promise<string> {
  const imageHash = await sha256HexBytes(input.image_bytes);
  const canonical = canonicalJson({
    image_bytes_sha256: imageHash,
    node_tree_summary: input.node_tree_summary as CanonicalValue,
  });
  return sha256HexString(canonical);
}

export async function imageBytesSha256(image: Uint8Array): Promise<string> {
  return sha256HexBytes(image);
}
