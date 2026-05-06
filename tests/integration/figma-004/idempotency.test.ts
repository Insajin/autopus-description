// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S1 idempotency.
// REQ-07, REQ-NFR-01, INV-001.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

import { WriteRouter } from "@autopus/write-router";
import { computeManifestEntryHash } from "@autopus/write-router/idempotency";
import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  env.cleanup();
});

describe("AC-S1: idempotency on duplicate apply (REQ-07, REQ-NFR-01)", () => {
  it("first apply invokes Figma createText exactly 1 time and emits exactly 1 audit line", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "annotation_card" });
    const expectedHash = computeManifestEntryHash(entry);

    await router.apply(entry);

    expect(server.calls.createText).toHaveLength(1);
    expect(server.calls.createText[0].text).toContain("사용자 인증 게이트");

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(Object.keys(parsed).sort()).toEqual([
      "frame_id",
      "manifest_entry_hash",
      "pm_identity_or_unknown",
      "timestamp_iso",
      "write_target",
    ]);
    expect(parsed.write_target).toBe("annotation_card");
    expect(parsed.pm_identity_or_unknown).toBe("unknown");
    expect(parsed.manifest_entry_hash).toBe(expectedHash);
  });

  it("second apply without intervening edits skips Figma write and emits IDEMPOTENT_SKIP audit entry", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "annotation_card" });
    const expectedHash = computeManifestEntryHash(entry);

    await router.apply(entry);
    const second = await router.apply(entry).catch((e) => e);

    expect(server.calls.createText).toHaveLength(1);
    const code =
      (second as { code?: string }).code ??
      (second as { status_code?: string }).status_code;
    expect(code).toBe("IDEMPOTENT_SKIP");

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const skipped = JSON.parse(lines[1]);
    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toBe("IDEMPOTENT_SKIP");
    expect(skipped.manifest_entry_hash).toBe(expectedHash);
  });
});
