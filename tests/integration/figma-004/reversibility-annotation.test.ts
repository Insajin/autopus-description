// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S2 annotation_card undo.
// REQ-08, REQ-NFR-02, INV-002.

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { WriteRouter } from "@autopus/write-router";
import type { UndoDescriptor } from "@autopus/write-router/types";
import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  env.cleanup();
});

describe("AC-S2: annotation_card reversibility (REQ-08, REQ-NFR-02)", () => {
  it("apply registers delete-node undo descriptor with the returned node id 'node-9001'", async () => {
    const server = createMockFigmaWriteServer({ createTextReturnsNodeId: "node-9001" });
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "annotation_card", intent: "로그인 게이트" });

    const result = await router.apply(entry);

    expect(server.calls.createText).toHaveLength(1);
    expect(result.status).toBe("applied");
    expect(result.undo_descriptor).toMatchObject<Partial<UndoDescriptor>>({
      type: "delete-node",
      node_id: "node-9001",
    });
    expect(router.getEntryStatus(entry)).toBe("applied");
  });

  it("undo invokes deleteNode('node-9001') exactly 1 time and reverts entry status to pending", async () => {
    const server = createMockFigmaWriteServer({ createTextReturnsNodeId: "node-9001" });
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "annotation_card" });

    const { write_id } = await router.apply(entry);
    await router.undo(write_id);

    expect(server.calls.deleteNode).toHaveLength(1);
    expect(server.calls.deleteNode[0].node_id).toBe("node-9001");
    expect(router.getEntryStatus(entry)).toBe("pending");
    expect(router.hasUndoEntry(write_id)).toBe(false);
  });
});
