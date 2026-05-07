/**
 * SPEC-FIGMA-008 Phase 3 — branch-coverage tests for tunnel-audit-emitter.ts.
 *
 * Targets the missing branch in emitTerminal: ts default + auditPath dir
 * mkdir branch when path's parent directory does not yet exist.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TunnelAuditEmitter } from "../../src/daemon/tunnel-audit-emitter.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-tunnel-audit-br-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("TunnelAuditEmitter branch coverage", () => {
  it("emitTerminal uses caller-provided ts when present", () => {
    const auditPath = join(workDir, "audit.jsonl");
    const e = new TunnelAuditEmitter({ auditPath });
    e.emitTerminal({
      tunnel_session_id: "ts_branch_01",
      event: "tunnel_session_closed_clean",
      ts: "2026-05-07T00:00:00.000Z",
    });
    const row = JSON.parse(readFileSync(auditPath, "utf8").trim());
    expect(row.ts).toBe("2026-05-07T00:00:00.000Z");
  });

  it("emitTerminal supplies ISO-8601 ts default when caller omits it", () => {
    const auditPath = join(workDir, "audit.jsonl");
    const e = new TunnelAuditEmitter({ auditPath });
    e.emitTerminal({
      tunnel_session_id: "ts_branch_02",
      event: "tunnel_session_revoked",
    });
    const row = JSON.parse(readFileSync(auditPath, "utf8").trim());
    expect(typeof row.ts).toBe("string");
    expect(Date.parse(String(row.ts))).toBeGreaterThan(0);
  });

  it("creates parent directory when auditPath dir does not exist (mkdir branch)", () => {
    const nestedDir = join(workDir, "deep", "nested", "audit");
    const auditPath = join(nestedDir, "audit.jsonl");
    expect(existsSync(nestedDir)).toBe(false);
    const e = new TunnelAuditEmitter({ auditPath });
    e.emitAttached({
      tunnel_session_id: "ts_mkdir_01",
      profile_id: "claude-cowork-remote",
      attached_at: "2026-05-07T00:00:00.000Z",
      ttl_ms: 60_000,
      bearer_sha256: "a".repeat(64),
    });
    expect(existsSync(auditPath)).toBe(true);
  });

  it("emitTerminal accepts the unauthorized event in the enum", () => {
    const auditPath = join(workDir, "audit.jsonl");
    const e = new TunnelAuditEmitter({ auditPath });
    expect(() =>
      e.emitTerminal({
        tunnel_session_id: "ts_branch_03",
        event: "tunnel_session_unauthorized",
      }),
    ).not.toThrow();
  });
});
