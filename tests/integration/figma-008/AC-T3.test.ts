/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T3.
 *
 * REQ-02: WHEN MCP client connects, daemon advertises one mcp-client-profile
 * negotiation message back. INV-T1 capability profile additivity.
 *
 * [NEW] surfaces:
 *   - Daemon.handleClientHandshake({clientName, transport}): Promise<ProfileAdvert>
 *   - ProfileAdvert keys: {profile_id, capabilities, protocol_version, transport}
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Daemon } from "../../../src/daemon/server.js";

const ADVERT_KEYS = ["capabilities", "profile_id", "protocol_version", "transport"];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-t3-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-T3 mcp-client-profile negotiation handshake", () => {
  it("Test_Handshake_StdioClaudeCode_AdvertProfileLocalWithBaselineCaps", async () => {
    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    // [NEW] handleClientHandshake — drives negotiation message.
    const advert = await daemon.handleClientHandshake({
      clientName: "claude-code",
      transport: "stdio",
    });

    expect(Object.keys(advert).sort()).toEqual(ADVERT_KEYS);
    expect(advert.profile_id).toBe("claude-code-local");
    expect(advert.capabilities).toEqual(["resources.read", "tools.call"]);
    expect(advert.protocol_version).toBe(1);
    expect(advert.transport).toBe("stdio");

    await daemon.shutdown();
  });

  it("Test_Handshake_HttpCodexWindows_AdvertCodexWindowsStdio", async () => {
    const daemon = new Daemon({ auditDir: join(workDir, ".autopus") });
    await daemon.boot();

    const advert = await daemon.handleClientHandshake({
      clientName: "codex-windows",
      transport: "http",
    });
    expect(advert.profile_id).toBe("codex-windows-stdio");
    expect(advert.capabilities).toEqual(["resources.read", "tools.call"]);
    expect(advert.protocol_version).toBe(1);
    expect(advert.transport).toBe("http");

    await daemon.shutdown();
  });

  it("Test_Handshake_TunnelClaudeCowork_AdvertCoworkRemoteWithFallbackPolling", async () => {
    const daemon = new Daemon({ auditDir: join(workDir, ".autopus") });
    await daemon.boot();

    const advert = await daemon.handleClientHandshake({
      clientName: "claude-cowork",
      transport: "tunnel",
    });
    expect(advert.profile_id).toBe("claude-cowork-remote");
    expect(advert.capabilities.slice(0, 3)).toEqual([
      "resources.read",
      "tools.call",
      "fallback.polling",
    ]);
    expect(advert.protocol_version).toBe(1);
    expect(advert.transport).toBe("tunnel");

    await daemon.shutdown();
  });
});
