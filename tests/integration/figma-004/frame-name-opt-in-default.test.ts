// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S5 frame_name opt-in default disabled.
// REQ-05, INV-005 (default disable).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

import { WriteRouter } from "@autopus/write-router";
import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
  delete process.env.ALLOW_FRAME_NAME;
});

afterEach(() => {
  env.cleanup();
});

describe("AC-S5: frame_name opt-in default disabled (REQ-05)", () => {
  it("rejects with FRAME_NAME_OPT_IN_REQUIRED and invokes zero Figma write APIs", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "frame_name", screen_id: "AUTH-01" });

    const err = await router.apply(entry).catch((e) => e);

    expect((err as { code?: string }).code).toBe("FRAME_NAME_OPT_IN_REQUIRED");
    expect(server.calls.createText).toHaveLength(0);
    expect(server.calls.setFrameName).toHaveLength(0);
    expect(server.calls.commentPost).toHaveLength(0);
    expect(server.calls.setPluginData).toHaveLength(0);
  });

  it("audit log records exactly 1 line with status='rejected' and reason='FRAME_NAME_OPT_IN_REQUIRED'", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "frame_name", screen_id: "AUTH-01" });

    await router.apply(entry).catch(() => undefined);

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.status).toBe("rejected");
    expect(parsed.reason).toBe("FRAME_NAME_OPT_IN_REQUIRED");
  });
});
