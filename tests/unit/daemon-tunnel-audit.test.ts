/**
 * SPEC-FIGMA-008 Phase 1.5 RED unit scaffold — tunnel audit emission.
 *
 * REQ-06, INV-T2 audit-per-call coverage, INV-T7 redaction zero-match.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TunnelAuditEmitter } from "../../src/daemon/tunnel-audit-emitter.js";

let workDir: string;
let auditPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-fig008-tunnel-audit-"));
  auditPath = join(workDir, "audit.jsonl");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("TunnelAuditEmitter (SPEC-FIGMA-008 unit)", () => {
  it("emits one tunnel_session_attached row with exact key set", () => {
    const e = new TunnelAuditEmitter({ auditPath });
    e.emitAttached({
      tunnel_session_id: "ts_unit_01",
      profile_id: "claude-cowork-remote",
      attached_at: "2026-05-07T00:00:00.000Z",
      ttl_ms: 28_800_000,
      bearer_sha256: "a".repeat(64),
    });
    const rows = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "attached_at",
      "bearer_sha256",
      "event",
      "profile_id",
      "ttl_ms",
      "tunnel_session_id",
    ]);
    expect(rows[0].event).toBe("tunnel_session_attached");
  });

  it("emits one tunnel_call row per MCP call (INV-T2)", () => {
    const e = new TunnelAuditEmitter({ auditPath });
    for (let i = 0; i < 5; i++) {
      e.emitCall({
        tunnel_session_id: "ts_unit_02",
        profile_id: "claude-cowork-remote",
        mcp_method: "tools/call",
        resource_uri_or_tool_name: `tool_${i}`,
        ts: `2026-05-07T00:00:0${i}.000Z`,
      });
    }
    const calls = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "tunnel_call");
    expect(calls).toHaveLength(5);
  });

  it("redacts trycloudflare URLs and figd_ tokens before write (INV-T7)", () => {
    const e = new TunnelAuditEmitter({ auditPath });
    e.emitCall({
      tunnel_session_id: "ts_unit_03",
      profile_id: "claude-cowork-remote",
      mcp_method: "resources/read",
      resource_uri_or_tool_name: "figma://leaked?u=https://abc.trycloudflare.com/x&t=figd_LEAKLEAKLEAKLEAK",
      ts: "2026-05-07T00:00:00.000Z",
    });
    const raw = readFileSync(auditPath, "utf8");
    expect(raw).not.toMatch(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    expect(raw).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
  });

  it("emits terminal row event from {expired, revoked, closed_clean} enum only", () => {
    const e = new TunnelAuditEmitter({ auditPath });
    expect(() =>
      e.emitTerminal({
        tunnel_session_id: "ts_unit_04",
        // @ts-expect-error — invalid event must throw at runtime
        event: "tunnel_session_unknown_terminal",
      }),
    ).toThrow();
  });
});
