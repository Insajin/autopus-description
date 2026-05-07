// SPEC-FIGMA-009 T5 / AC-W1 / REQ-05 — Phase 1.5 RED scaffold.
// Verifies that the stdio entry emits exactly one client_profile_attached
// audit row per handshake with byte-equal capabilities to the
// claude-code-local profile baseline (SPEC-FIGMA-006 AC-S11 / SPEC-FIGMA-008
// INV-007). INV-W1 — exactly one row per handshake (no duplicate, no skip).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { emitClientProfileAttached } from "../../src/daemon/mcp-stdio-entry.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig009-handshake-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function readAttachedRows(dir: string): Record<string, unknown>[] {
  const path = join(dir, "audit.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((r) => r.event === "client_profile_attached");
}

describe("mcp-stdio handshake — client_profile_attached emission (AC-W1)", () => {
  it("emits exactly one row with byte-equal capabilities for clientName='claude-code'", () => {
    const audit = new DaemonAuditWriter({ auditDir: workDir, provider: "test" });
    const registry = new CapabilityProfileRegistry();

    emitClientProfileAttached({
      audit,
      registry,
      clientName: "claude-code",
    });

    const rows = readAttachedRows(workDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe("claude-code");
    expect(rows[0].transport).toBe("stdio");
    expect(rows[0].profile_id).toBe("claude-code-local");
    // Byte-equal to SPEC-FIGMA-006 AC-S11 stdio baseline.
    expect(rows[0].capabilities).toEqual(["resources.read", "tools.call"]);
    // attached_at — ISO-8601 timestamp.
    expect(typeof rows[0].attached_at).toBe("string");
    expect(Number.isFinite(Date.parse(rows[0].attached_at as string))).toBe(true);
    // No tunnel_session_id key (cowork-only field).
    expect(Object.prototype.hasOwnProperty.call(rows[0], "tunnel_session_id")).toBe(false);
  });

  it("matchProfile maps 'claude-code' + transport='stdio' to claude-code-local", () => {
    const registry = new CapabilityProfileRegistry();
    const profile = registry.matchProfile({ clientName: "claude-code", transport: "stdio" });
    expect(profile).not.toBeNull();
    expect(profile?.profile_id).toBe("claude-code-local");
    // Byte-equal capabilities baseline (SPEC-FIGMA-006 AC-S11).
    expect([...(profile?.capabilities ?? [])]).toEqual(["resources.read", "tools.call"]);
  });

  it("two handshake invocations produce exactly two rows (INV-W1 per-handshake invariant)", () => {
    const audit = new DaemonAuditWriter({ auditDir: workDir, provider: "test" });
    const registry = new CapabilityProfileRegistry();

    emitClientProfileAttached({ audit, registry, clientName: "claude-code" });
    emitClientProfileAttached({ audit, registry, clientName: "claude-code" });

    const rows = readAttachedRows(workDir);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.profile_id).toBe("claude-code-local");
      expect(row.capabilities).toEqual(["resources.read", "tools.call"]);
    }
  });

  it("falls back to default profile when clientInfo.name is absent (uses transport=stdio)", () => {
    const audit = new DaemonAuditWriter({ auditDir: workDir, provider: "test" });
    const registry = new CapabilityProfileRegistry();

    emitClientProfileAttached({ audit, registry, clientName: "unknown" });

    const rows = readAttachedRows(workDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].profile_id).toBe("claude-code-local");
    expect(rows[0].capabilities).toEqual(["resources.read", "tools.call"]);
    expect(rows[0].client_id).toBe("unknown");
  });
});
