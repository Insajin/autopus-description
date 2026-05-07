/**
 * SPEC-FIGMA-008 Phase 3 — coverage tests for plugin-session-persistence.ts.
 *
 * Targets uncovered lines 38-41 (clearSessionFromPluginStorage).
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  commitSessionToPluginStorage,
  clearSessionFromPluginStorage,
  PLUGIN_DATA_KEY_TOKEN_HASH,
  PLUGIN_DATA_KEY_BEARER,
  PLUGIN_DATA_KEY_TUNNEL_URL,
  CLIENT_STORAGE_KEY_BEARER,
  ZERO_OUT_HASH,
} from "../../src/daemon/plugin-session-persistence.js";
import { PluginStorageMock } from "../../src/daemon/plugin-port.js";

describe("commitSessionToPluginStorage (SPEC-FIGMA-008)", () => {
  it("writes sha256 hash to pluginData and raw bearer to clientStorage", async () => {
    const storage = new PluginStorageMock();
    const bearer = "bearer_" + "Z".repeat(32);
    const salt = "abcd".repeat(8);
    const expected = createHash("sha256").update(bearer + ":" + salt).digest("hex");

    await commitSessionToPluginStorage({
      bearer,
      salt,
      tunnelUrl: "https://x.trycloudflare.com",
      storage,
    });

    expect(storage.pluginData.get(PLUGIN_DATA_KEY_TOKEN_HASH)).toBe(expected);
    expect(storage.pluginData.get(PLUGIN_DATA_KEY_BEARER)).toBe("");
    expect(storage.pluginData.get(PLUGIN_DATA_KEY_TUNNEL_URL)).toBe("");
    expect(await storage.clientStorage.getAsync(CLIENT_STORAGE_KEY_BEARER)).toBe(bearer);
  });
});

describe("clearSessionFromPluginStorage (SPEC-FIGMA-008)", () => {
  it("zero-outs token_hash, blanks bearer/tunnel_url keys, deletes clientStorage bearer", async () => {
    const storage = new PluginStorageMock();
    // Pre-seed state from a prior session.
    storage.pluginData.set(PLUGIN_DATA_KEY_TOKEN_HASH, "f".repeat(64));
    storage.pluginData.set(PLUGIN_DATA_KEY_BEARER, "leftover");
    storage.pluginData.set(PLUGIN_DATA_KEY_TUNNEL_URL, "leftover-url");
    await storage.clientStorage.setAsync(CLIENT_STORAGE_KEY_BEARER, "bearer_LIVE");

    await clearSessionFromPluginStorage(storage);

    expect(storage.pluginData.get(PLUGIN_DATA_KEY_TOKEN_HASH)).toBe(ZERO_OUT_HASH);
    expect(storage.pluginData.get(PLUGIN_DATA_KEY_BEARER)).toBe("");
    expect(storage.pluginData.get(PLUGIN_DATA_KEY_TUNNEL_URL)).toBe("");
    expect(await storage.clientStorage.getAsync(CLIENT_STORAGE_KEY_BEARER)).toBeUndefined();
  });

  it("clear is idempotent — calling on empty storage produces zero-out + empty + missing", async () => {
    const storage = new PluginStorageMock();
    await clearSessionFromPluginStorage(storage);
    expect(storage.pluginData.get(PLUGIN_DATA_KEY_TOKEN_HASH)).toBe(ZERO_OUT_HASH);
    expect(storage.pluginData.get(PLUGIN_DATA_KEY_BEARER)).toBe("");
    expect(await storage.clientStorage.getAsync(CLIENT_STORAGE_KEY_BEARER)).toBeUndefined();
  });
});

describe("FigmaPluginSessionShim (SPEC-FIGMA-008)", () => {
  it("set/get IndexedDB bearer round-trips and undefined → undefined", async () => {
    const { FigmaPluginSessionShim } = await import(
      "../../src/daemon/plugin-session-persistence.js"
    );
    const s = new FigmaPluginSessionShim();
    expect(s.getIndexedDBBearer()).toBeUndefined();
    s.setIndexedDBBearer("bearer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(s.getIndexedDBBearer()).toBe("bearer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    s.setIndexedDBBearer(undefined);
    expect(s.getIndexedDBBearer()).toBeUndefined();
  });

  it("setPluginDataTokenHash + getPluginDataTokenHash round-trip and default to empty string", async () => {
    const { FigmaPluginSessionShim } = await import(
      "../../src/daemon/plugin-session-persistence.js"
    );
    const s = new FigmaPluginSessionShim();
    expect(s.getPluginDataTokenHash()).toBe("");
    s.setPluginDataTokenHash("a".repeat(64));
    expect(s.getPluginDataTokenHash()).toBe("a".repeat(64));
  });

  it("arbitrary pluginData key set/get + getPluginDataKeys lists all keys", async () => {
    const { FigmaPluginSessionShim } = await import(
      "../../src/daemon/plugin-session-persistence.js"
    );
    const s = new FigmaPluginSessionShim();
    expect(s.getPluginDataKey("missing")).toBe("");
    s.setPluginDataKey("autopus.session.tunnel_url", "https://x");
    s.setPluginDataKey("custom", "value");
    expect(s.getPluginDataKey("autopus.session.tunnel_url")).toBe("https://x");
    expect(s.getPluginDataKey("custom")).toBe("value");
    expect(s.getPluginDataKeys().sort()).toEqual(
      ["autopus.session.tunnel_url", "custom"].sort(),
    );
  });

  it("clearAll resets both IndexedDB bearer and pluginData keys", async () => {
    const { FigmaPluginSessionShim } = await import(
      "../../src/daemon/plugin-session-persistence.js"
    );
    const s = new FigmaPluginSessionShim();
    s.setIndexedDBBearer("bearer_KEEP_NOT");
    s.setPluginDataTokenHash("f".repeat(64));
    s.setPluginDataKey("k", "v");

    s.clearAll();

    expect(s.getIndexedDBBearer()).toBeUndefined();
    expect(s.getPluginDataTokenHash()).toBe("");
    expect(s.getPluginDataKey("k")).toBe("");
    expect(s.getPluginDataKeys()).toEqual([]);
  });
});
