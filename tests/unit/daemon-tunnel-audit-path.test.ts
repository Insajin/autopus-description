/**
 * SPEC-FIGMA-008 Phase 3 — coverage tests for tunnel-audit-path.ts.
 *
 * Targets line 26 (clearTunnelAuditPath) + the cwd-fallback branch in resolve.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";

import {
  registerTunnelAuditPath,
  resolveTunnelAuditPath,
  clearTunnelAuditPath,
} from "../../src/daemon/tunnel-audit-path.js";

beforeEach(() => {
  clearTunnelAuditPath();
});

describe("tunnel-audit-path resolver (SPEC-FIGMA-008)", () => {
  it("resolveTunnelAuditPath returns explicit path when given (highest precedence)", () => {
    registerTunnelAuditPath("/should/be/ignored");
    expect(resolveTunnelAuditPath("/explicit/audit.jsonl")).toBe("/explicit/audit.jsonl");
  });

  it("resolveTunnelAuditPath returns registered path joined with audit.jsonl", () => {
    registerTunnelAuditPath("/tmp/autopus-test");
    expect(resolveTunnelAuditPath()).toBe(join("/tmp/autopus-test", "audit.jsonl"));
  });

  it("resolveTunnelAuditPath falls back to cwd/.autopus/audit.jsonl when not registered", () => {
    clearTunnelAuditPath();
    const expected = join(process.cwd(), ".autopus", "audit.jsonl");
    expect(resolveTunnelAuditPath()).toBe(expected);
  });

  it("clearTunnelAuditPath drops the registered slot back to cwd-fallback", () => {
    registerTunnelAuditPath("/tmp/registered");
    expect(resolveTunnelAuditPath()).toBe(join("/tmp/registered", "audit.jsonl"));
    clearTunnelAuditPath();
    expect(resolveTunnelAuditPath()).toBe(join(process.cwd(), ".autopus", "audit.jsonl"));
  });
});
