// SPEC-FIGMA-008 REQ-05, AC-T7, AC-T8 — plugin-side session storage port.
//
// Bridges the Figma plugin's two storage surfaces to satisfy the SPEC's
// pluginData unrecoverability invariant (INV-T6):
//
//   * `figma.clientStorage` (origin-isolated IndexedDB) holds the raw bearer.
//   * `figma.currentPage.pluginData` (file-shared plaintext) holds ONLY the
//     lowercase hex sha256 of `bearer + ":" + saltHex`.
//
// Tunnel URL must NEVER be persisted on either surface.
//
// The bearer hash port uses WebCrypto (subtle.digest("SHA-256", ...)) so that
// the byte-string emitted from the plugin matches the Node-side
// `TunnelSession.bearerSha256` reference vector byte-equal (AC-T8 oracle).

const PLUGIN_DATA_KEY_TOKEN_HASH = "autopus.session.token_hash";
const PLUGIN_DATA_KEY_BEARER = "autopus.session.bearer";
const PLUGIN_DATA_KEY_TUNNEL_URL = "autopus.session.tunnel_url";
const CLIENT_STORAGE_KEY_BEARER = "autopus.session.bearer";
const ZERO_OUT_HASH = "0".repeat(64);

/**
 * The narrow surface of the Figma plugin runtime this port depends on.
 *
 * Tests inject an in-memory fake; production passes the real `figma` global.
 */
export interface FigmaSessionAPI {
  readonly clientStorage: {
    getAsync(key: string): Promise<unknown>;
    setAsync(key: string, value: unknown): Promise<void>;
    deleteAsync(key: string): Promise<void>;
  };
  readonly currentPage: {
    setPluginData(key: string, value: string): void;
    getPluginData(key: string): string;
    getPluginDataKeys(): string[];
  };
}

export interface CommitSessionInput {
  readonly bearer: string;
  readonly saltHex: string;
  readonly figma: FigmaSessionAPI;
}

export interface ClearSessionInput {
  readonly figma: FigmaSessionAPI;
}

/**
 * REQ-05 commit path. Writes:
 *   * clientStorage["autopus.session.bearer"] = bearer (origin-isolated)
 *   * pluginData["autopus.session.token_hash"] = sha256Hex(bearer:saltHex)
 *
 * NEVER writes the raw bearer or tunnel URL to pluginData.
 */
export async function commitSessionToPluginStorage(input: CommitSessionInput): Promise<void> {
  const tokenHash = await computeBearerSha256WebCrypto(input.bearer, input.saltHex);
  await input.figma.clientStorage.setAsync(CLIENT_STORAGE_KEY_BEARER, input.bearer);
  input.figma.currentPage.setPluginData(PLUGIN_DATA_KEY_TOKEN_HASH, tokenHash);
  // Defensive: ensure raw-bearer / tunnel-url pluginData slots stay empty.
  input.figma.currentPage.setPluginData(PLUGIN_DATA_KEY_BEARER, "");
  input.figma.currentPage.setPluginData(PLUGIN_DATA_KEY_TUNNEL_URL, "");
}

/**
 * AC-T7 revoke path. Deletes the bearer from clientStorage and resets the
 * pluginData token-hash entry to the literal `"0".repeat(64)` zero-out
 * placeholder (AC-T7 line 131 oracle).
 */
export async function clearSessionFromPluginStorage(input: ClearSessionInput): Promise<void> {
  await input.figma.clientStorage.deleteAsync(CLIENT_STORAGE_KEY_BEARER);
  input.figma.currentPage.setPluginData(PLUGIN_DATA_KEY_TOKEN_HASH, ZERO_OUT_HASH);
  input.figma.currentPage.setPluginData(PLUGIN_DATA_KEY_BEARER, "");
  input.figma.currentPage.setPluginData(PLUGIN_DATA_KEY_TUNNEL_URL, "");
}

/**
 * AC-T8 byte-equality oracle. Computes `sha256Hex(bearer + ":" + saltHex)`
 * via WebCrypto so the plugin emits the same hash as the Node-side
 * `TunnelSession.bearerSha256`. Output matches `^[a-f0-9]{64}$`.
 */
export async function computeBearerSha256WebCrypto(bearer: string, saltHex: string): Promise<string> {
  const input = bearer + ":" + saltHex;
  const subtle = await resolveSubtleCrypto();
  const buf = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", buf);
  return hexEncode(new Uint8Array(digest));
}

/**
 * Read whatever the plugin currently persists as the token-hash. Empty string
 * if not set. Useful for the plugin status surface and integration debugging.
 */
export function readPluginDataTokenHash(figma: FigmaSessionAPI): string {
  return figma.currentPage.getPluginData(PLUGIN_DATA_KEY_TOKEN_HASH) ?? "";
}

interface SubtleLike {
  digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
}

async function resolveSubtleCrypto(): Promise<SubtleLike> {
  // Figma plugin sandbox exposes globalThis.crypto.subtle. In Node test
  // environments we fall back to webcrypto from node:crypto.
  const g = globalThis as unknown as { crypto?: { subtle?: SubtleLike } };
  if (g.crypto?.subtle) return g.crypto.subtle;
  const nodeCrypto = (await import("node:crypto")) as { webcrypto?: { subtle?: SubtleLike } };
  if (!nodeCrypto.webcrypto?.subtle) {
    throw new Error("autopus_session_storage: SubtleCrypto unavailable");
  }
  return nodeCrypto.webcrypto.subtle;
}

function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export const PLUGIN_DATA_KEYS = {
  TOKEN_HASH: PLUGIN_DATA_KEY_TOKEN_HASH,
  BEARER: PLUGIN_DATA_KEY_BEARER,
  TUNNEL_URL: PLUGIN_DATA_KEY_TUNNEL_URL,
} as const;

export const CLIENT_STORAGE_KEYS = {
  BEARER: CLIENT_STORAGE_KEY_BEARER,
} as const;

export const ZERO_OUT_TOKEN_HASH = ZERO_OUT_HASH;
