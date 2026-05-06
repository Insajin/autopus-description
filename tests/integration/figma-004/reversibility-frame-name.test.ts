// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S3 frame_name undo restores original name.
// REQ-08, REQ-NFR-02, REQ-04(e), INV-002.

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { WriteRouter } from "@autopus/write-router";
import type { UndoDescriptor } from "@autopus/write-router/types";
import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
  process.env.ALLOW_FRAME_NAME = "1";
});

afterEach(() => {
  delete process.env.ALLOW_FRAME_NAME;
  env.cleanup();
});

describe("AC-S3: frame_name reversibility (REQ-08, REQ-NFR-02)", () => {
  it("apply with opt-in invokes setFrameName('Login · AUTH-01') and registers restore-frame-name undo", async () => {
    const server = createMockFigmaWriteServer({ initialFrameName: "Login" });
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "frame_name", screen_id: "AUTH-01" });

    const result = await router.apply(entry);

    expect(server.calls.setFrameName).toHaveLength(1);
    expect(server.calls.setFrameName[0].name).toBe("Login · AUTH-01");
    expect(result.undo_descriptor).toMatchObject<Partial<UndoDescriptor>>({
      type: "restore-frame-name",
      original_name: "Login",
    });
  });

  it("undo restores frame name to exactly 'Login' byte-for-byte (no whitespace difference)", async () => {
    const server = createMockFigmaWriteServer({ initialFrameName: "Login" });
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "frame_name", screen_id: "AUTH-01" });

    const { write_id } = await router.apply(entry);
    await router.undo(write_id);

    const last = server.calls.setFrameName[server.calls.setFrameName.length - 1].name;
    expect(last).toBe("Login");
    expect(server.readFrameName()).toBe("Login");
  });
});
