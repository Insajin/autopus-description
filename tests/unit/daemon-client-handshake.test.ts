/**
 * SPEC-FIGMA-008 Phase 3 — coverage tests for client-handshake.ts.
 *
 * Targets line 35 (no-match throw branch).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { performClientHandshake } from "../../src/daemon/client-handshake.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";

let workDir: string;
let audit: DaemonAuditWriter;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-handshake-"));
  audit = new DaemonAuditWriter({ auditDir: workDir, provider: "test" });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("performClientHandshake (SPEC-FIGMA-008)", () => {
  it("returns advert with profile_id, capabilities, protocol_version=1, transport for stdio claude-code", () => {
    const advert = performClientHandshake(audit, {
      clientName: "claude-code",
      transport: "stdio",
    });
    expect(advert.profile_id).toBe("claude-code-local");
    expect(advert.capabilities).toEqual(["resources.read", "tools.call"]);
    expect(advert.protocol_version).toBe(1);
    expect(advert.transport).toBe("stdio");
  });

  it("emits client_profile_attached audit row with extended fields {profile_id, tunnel_session_id, attached_at}", () => {
    performClientHandshake(audit, {
      clientName: "claude-cowork",
      transport: "tunnel",
      tunnelSessionId: "ts_HANDSHAKE_01",
    });
    const rows = readFileSync(join(workDir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "client_profile_attached");
    expect(rows).toHaveLength(1);
    expect(rows[0].profile_id).toBe("claude-cowork-remote");
    expect(rows[0].tunnel_session_id).toBe("ts_HANDSHAKE_01");
    expect(typeof rows[0].attached_at).toBe("string");
    expect(Date.parse(rows[0].attached_at)).toBeGreaterThan(0);
  });

  it("emits row with tunnelSessionId === null when not provided", () => {
    performClientHandshake(audit, {
      clientName: "claude-code",
      transport: "stdio",
    });
    const rows = readFileSync(join(workDir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "client_profile_attached");
    expect(rows[0].tunnel_session_id).toBeNull();
  });

  it("throws when no profile matches client+transport (unknown transport literal)", () => {
    expect(() =>
      performClientHandshake(audit, {
        clientName: "totally-unknown",
        transport: "ws-wonderland" as unknown as string,
      }),
    ).toThrow(/no profile matched/);
  });
});
