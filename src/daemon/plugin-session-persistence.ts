// SPEC-FIGMA-008 REQ-05 — daemon-side shim that mirrors the Figma plugin's
// session persistence contract. AC-T8 INV-T6 oracle: pluginData stores ONLY
// sha256(bearer + ":" + salt) hex, never the raw bearer or tunnel URL; raw
// bearer survives only in the origin-isolated clientStorage (IndexedDB).

import { createHash } from "node:crypto";

import type { PluginStorageLike } from "./tunnel-session-types.js";

export interface CommitSessionInput {
  readonly bearer: string;
  readonly salt: string;
  readonly tunnelUrl: string;
  readonly storage: PluginStorageLike;
}

export const PLUGIN_DATA_KEY_TOKEN_HASH = "autopus.session.token_hash";
export const PLUGIN_DATA_KEY_BEARER = "autopus.session.bearer";
export const PLUGIN_DATA_KEY_TUNNEL_URL = "autopus.session.tunnel_url";
export const CLIENT_STORAGE_KEY_BEARER = "autopus.session.bearer";
export const ZERO_OUT_HASH = "0".repeat(64);

export async function commitSessionToPluginStorage(input: CommitSessionInput): Promise<void> {
  const { bearer, salt, storage } = input;
  const hash = createHash("sha256").update(bearer + ":" + salt).digest("hex");
  // Persist the hash to pluginData (file-shared, plaintext to all collaborators).
  storage.pluginData.set(PLUGIN_DATA_KEY_TOKEN_HASH, hash);
  // Defensively zero out the raw-bearer + tunnel_url keys in case a previous
  // session left stale plaintext. AC-T8 oracle: getPluginData returns "" for
  // both keys (we map "absent" to empty string at the caller level).
  storage.pluginData.set(PLUGIN_DATA_KEY_BEARER, "");
  storage.pluginData.set(PLUGIN_DATA_KEY_TUNNEL_URL, "");
  // Raw bearer survives ONLY in the origin-isolated IndexedDB store.
  await storage.clientStorage.setAsync(CLIENT_STORAGE_KEY_BEARER, bearer);
}

export async function clearSessionFromPluginStorage(storage: PluginStorageLike): Promise<void> {
  storage.pluginData.set(PLUGIN_DATA_KEY_TOKEN_HASH, ZERO_OUT_HASH);
  storage.pluginData.set(PLUGIN_DATA_KEY_BEARER, "");
  storage.pluginData.set(PLUGIN_DATA_KEY_TUNNEL_URL, "");
  await storage.clientStorage.deleteAsync(CLIENT_STORAGE_KEY_BEARER);
}

// FigmaPluginSessionShim mirrors the Figma plugin's split storage surface for
// daemon-side dev/integration use. raw bearer lives ONLY in the IndexedDB-like
// store; pluginData receives only the token hash (or zero-out placeholder).
export class FigmaPluginSessionShim {
  private indexedDBBearer: string | undefined;
  private readonly pluginDataMap = new Map<string, string>();

  setIndexedDBBearer(bearer: string | undefined): void { this.indexedDBBearer = bearer; }
  getIndexedDBBearer(): string | undefined { return this.indexedDBBearer; }

  setPluginDataTokenHash(hash: string): void { this.pluginDataMap.set(PLUGIN_DATA_KEY_TOKEN_HASH, hash); }
  getPluginDataTokenHash(): string { return this.pluginDataMap.get(PLUGIN_DATA_KEY_TOKEN_HASH) ?? ""; }

  setPluginDataKey(key: string, value: string): void { this.pluginDataMap.set(key, value); }
  getPluginDataKey(key: string): string { return this.pluginDataMap.get(key) ?? ""; }
  getPluginDataKeys(): string[] { return Array.from(this.pluginDataMap.keys()); }

  clearAll(): void {
    this.indexedDBBearer = undefined;
    this.pluginDataMap.clear();
  }
}
