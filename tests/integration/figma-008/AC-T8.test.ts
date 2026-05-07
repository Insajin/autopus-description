/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T8.
 *
 * REQ-05, NFR-05, INV-T5 + INV-T6 unrecoverability oracle.
 *
 * pluginData NEVER stores raw bearer or raw URL. Only token_hash (sha256 hex)
 * goes into pluginData. Raw bearer lives in figma.clientStorage origin-isolated
 * IndexedDB.
 *
 * [NEW] surfaces:
 *   - vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_session_persistence.ts
 *     OR a port-mock — PluginSessionPersistence.commit({bearer, salt, tunnelUrl})
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import { PluginStorageMock } from "../../../src/daemon/plugin-port.js";
import { commitSessionToPluginStorage } from "../../../src/daemon/plugin-session-persistence.js";

const REF_BEARER = "bearer_XYZ123XYZ123XYZ123XYZ123XYZ123";
const REF_SALT = "deadbeefdeadbeefdeadbeefdeadbeef";
const EXPECTED_HASH = createHash("sha256")
  .update(REF_BEARER + ":" + REF_SALT)
  .digest("hex");
const REF_URL = "https://leak-test.trycloudflare.com";

describe("AC-T8 pluginData token-hash unrecoverability", () => {
  it("Test_PluginCommit_RefVector_HashByteEqualAndPluginDataHasNoRawSecrets", async () => {
    const storage = new PluginStorageMock();

    await commitSessionToPluginStorage({
      bearer: REF_BEARER,
      salt: REF_SALT,
      tunnelUrl: REF_URL,
      storage,
    });

    // Hash matches reference vector exactly.
    const persistedHash = storage.pluginData.get("autopus.session.token_hash");
    expect(persistedHash).toBe(EXPECTED_HASH);
    expect(persistedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedHash).not.toMatch(/^bearer_[A-Za-z0-9_-]{16,}$/);

    // pluginData MUST NOT contain raw bearer or URL.
    expect(storage.pluginData.get("autopus.session.bearer") ?? "").toBe("");
    expect(storage.pluginData.get("autopus.session.tunnel_url") ?? "").toBe("");

    // No pluginData value contains the literal "trycloudflare.com".
    for (const v of storage.pluginData.values()) {
      expect(v).not.toContain("trycloudflare.com");
    }

    // Raw bearer survives ONLY in clientStorage (origin-isolated IndexedDB).
    const inClientStorage = await storage.clientStorage.getAsync("autopus.session.bearer");
    expect(inClientStorage).toBe(REF_BEARER);
  });

  it("Test_PluginCommit_RawBearerNeverAppearsInAnyPluginDataValue", async () => {
    const storage = new PluginStorageMock();
    await commitSessionToPluginStorage({
      bearer: REF_BEARER,
      salt: REF_SALT,
      tunnelUrl: REF_URL,
      storage,
    });
    for (const v of storage.pluginData.values()) {
      expect(v).not.toContain(REF_BEARER);
    }
  });
});
