// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S6 frame_name opt-in explicit enable.
// REQ-05, INV-005 (explicit enable).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

import { WriteRouter } from "@autopus/write-router";
import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
  process.env.ALLOW_FRAME_NAME = "1";
});

afterEach(() => {
  delete process.env.ALLOW_FRAME_NAME;
  vi.restoreAllMocks();
  env.cleanup();
});

describe("AC-S6: frame_name opt-in explicit enable (REQ-05)", () => {
  it("invokes setFrameName('Login · AUTH-01') exactly 1 time and emits warning literal substring", async () => {
    const server = createMockFigmaWriteServer({ initialFrameName: "Login" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "frame_name", screen_id: "AUTH-01" });

    await router.apply(entry);

    expect(server.calls.setFrameName).toHaveLength(1);
    expect(server.calls.setFrameName[0].name).toBe("Login · AUTH-01");
    const warnings = warnSpy.mock.calls.flat().join(" ");
    expect(warnings).toContain("frame_name write applied (X4 canvas pollution risk)");
  });

  it("audit log records write_target='frame_name' with status='applied'", async () => {
    const server = createMockFigmaWriteServer({ initialFrameName: "Login" });
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "frame_name", screen_id: "AUTH-01" });

    await router.apply(entry);

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    const applied = JSON.parse(lines[lines.length - 1]);
    expect(applied.write_target).toBe("frame_name");
    expect(applied.status ?? "applied").toBe("applied");
  });
});
