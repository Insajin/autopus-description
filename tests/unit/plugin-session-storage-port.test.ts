// SPEC-FIGMA-008 REQ-05 / AC-T8 — plugin-side session-storage port tests.
//
// Asserts the vendor plugin's `commitSessionToPluginStorage` /
// `clearSessionFromPluginStorage` / `computeBearerSha256WebCrypto`:
//
//   * never persist the raw bearer or the tunnel URL into pluginData (INV-T6)
//   * persist sha256(bearer + ":" + saltHex) byte-equal to the Node side
//     `TunnelSession.bearerSha256` reference vector (AC-T5/AC-T8 oracle)
//   * zero-out pluginData token-hash to "0".repeat(64) on clear (AC-T7 line 131)

import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

import {
  commitSessionToPluginStorage,
  clearSessionFromPluginStorage,
  computeBearerSha256WebCrypto,
  PLUGIN_DATA_KEYS,
  CLIENT_STORAGE_KEYS,
  ZERO_OUT_TOKEN_HASH,
  type FigmaSessionAPI,
} from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_session_storage.js";

class FakeFigma implements FigmaSessionAPI {
  private readonly cs = new Map<string, unknown>();
  private readonly pd = new Map<string, string>();
  readonly clientStorage = {
    getAsync: async (k: string) => this.cs.get(k),
    setAsync: async (k: string, v: unknown) => {
      this.cs.set(k, v);
    },
    deleteAsync: async (k: string) => {
      this.cs.delete(k);
    },
  };
  readonly currentPage = {
    setPluginData: (k: string, v: string) => {
      if (v === "") {
        // Mirror Figma's plugin runtime behaviour: setPluginData(k, "") removes
        // the key on the canvas. Use Map.delete so getPluginDataKeys() reflects.
        this.pd.delete(k);
      } else {
        this.pd.set(k, v);
      }
    },
    getPluginData: (k: string) => this.pd.get(k) ?? "",
    getPluginDataKeys: () => [...this.pd.keys()],
  };
  // Test helpers
  readClientStorage(k: string): unknown { return this.cs.get(k); }
  readPluginData(k: string): string { return this.pd.get(k) ?? ""; }
  pluginDataKeys(): string[] { return [...this.pd.keys()]; }
}

describe("plugin-session-storage-port — commitSessionToPluginStorage", () => {
  let figma: FakeFigma;
  beforeEach(() => { figma = new FakeFigma(); });

  it("persists raw bearer ONLY into clientStorage (origin-isolated)", async () => {
    await commitSessionToPluginStorage({
      bearer: "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123",
      saltHex: "deadbeefdeadbeefdeadbeefdeadbeef",
      figma,
    });
    expect(figma.readClientStorage(CLIENT_STORAGE_KEYS.BEARER)).toBe(
      "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123",
    );
  });

  it("persists sha256 hex into pluginData token_hash byte-equal to Node side", async () => {
    const bearer = "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123";
    const saltHex = "deadbeefdeadbeefdeadbeefdeadbeef";
    const expected = createHash("sha256").update(bearer + ":" + saltHex).digest("hex");

    await commitSessionToPluginStorage({ bearer, saltHex, figma });

    expect(figma.readPluginData(PLUGIN_DATA_KEYS.TOKEN_HASH)).toBe(expected);
    expect(figma.readPluginData(PLUGIN_DATA_KEYS.TOKEN_HASH)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never writes raw bearer into pluginData (INV-T6 unrecoverability)", async () => {
    await commitSessionToPluginStorage({
      bearer: "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123",
      saltHex: "deadbeefdeadbeefdeadbeefdeadbeef",
      figma,
    });
    for (const key of figma.pluginDataKeys()) {
      const value = figma.readPluginData(key);
      expect(value).not.toMatch(/^bearer_[A-Za-z0-9_-]{16,}$/);
    }
    expect(figma.readPluginData(PLUGIN_DATA_KEYS.BEARER)).toBe("");
  });

  it("never writes tunnel URL into pluginData", async () => {
    await commitSessionToPluginStorage({
      bearer: "bearer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      saltHex: "00112233445566778899aabbccddeeff",
      figma,
    });
    for (const key of figma.pluginDataKeys()) {
      expect(figma.readPluginData(key)).not.toContain("trycloudflare.com");
    }
    expect(figma.readPluginData(PLUGIN_DATA_KEYS.TUNNEL_URL)).toBe("");
  });
});

describe("plugin-session-storage-port — computeBearerSha256WebCrypto byte-equality", () => {
  it("matches Node createHash('sha256') for the AC-T5 reference vector", async () => {
    const bearer = "bearer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const saltHex = "00112233445566778899aabbccddeeff";
    const node = createHash("sha256").update(bearer + ":" + saltHex).digest("hex");
    const port = await computeBearerSha256WebCrypto(bearer, saltHex);
    expect(port).toBe(node);
  });

  it("matches Node side for the AC-T8 reference vector", async () => {
    const bearer = "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123";
    const saltHex = "deadbeefdeadbeefdeadbeefdeadbeef";
    const node = createHash("sha256").update(bearer + ":" + saltHex).digest("hex");
    const port = await computeBearerSha256WebCrypto(bearer, saltHex);
    expect(port).toBe(node);
    expect(port).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not match the bearer regex (zero false-positive — INV-T6)", async () => {
    const out = await computeBearerSha256WebCrypto("bearer_X".padEnd(40, "A"), "0".repeat(32));
    expect(out).not.toMatch(/^bearer_[A-Za-z0-9_-]{16,}$/);
  });
});

describe("plugin-session-storage-port — clearSessionFromPluginStorage", () => {
  it("deletes bearer from clientStorage and zero-outs pluginData token_hash", async () => {
    const figma = new FakeFigma();
    await commitSessionToPluginStorage({
      bearer: "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123",
      saltHex: "deadbeefdeadbeefdeadbeefdeadbeef",
      figma,
    });
    expect(figma.readClientStorage(CLIENT_STORAGE_KEYS.BEARER)).toBeDefined();

    await clearSessionFromPluginStorage({ figma });

    expect(figma.readClientStorage(CLIENT_STORAGE_KEYS.BEARER)).toBeUndefined();
    expect(figma.readPluginData(PLUGIN_DATA_KEYS.TOKEN_HASH)).toBe(ZERO_OUT_TOKEN_HASH);
    expect(ZERO_OUT_TOKEN_HASH).toBe("0".repeat(64));
  });

  it("is idempotent — second clear leaves the same zero-out state", async () => {
    const figma = new FakeFigma();
    await clearSessionFromPluginStorage({ figma });
    await clearSessionFromPluginStorage({ figma });
    expect(figma.readPluginData(PLUGIN_DATA_KEYS.TOKEN_HASH)).toBe(ZERO_OUT_TOKEN_HASH);
  });
});
