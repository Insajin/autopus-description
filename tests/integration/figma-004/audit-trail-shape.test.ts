// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S10 audit trail shape (exactly 5 keys).
// REQ-11, REQ-NFR-05, INV-009.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

import { WriteRouter } from "@autopus/write-router";
import { computeManifestEntryHash } from "@autopus/write-router/idempotency";

import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry, ISO_REGEX } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  env.cleanup();
});

describe("AC-S10: audit trail shape (REQ-11, REQ-NFR-05)", () => {
  it("3 sequential applies append exactly 3 lines with the precise 5-key set", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entries = [
      makeEntry({ screen_id: "AUTH-01", frame_id: "1:1", write_target: "annotation_card" }),
      makeEntry({ screen_id: "DASH-01", frame_id: "2:2", write_target: "comment" }),
      makeEntry({ screen_id: "PROF-01", frame_id: "3:3", write_target: "descriptions_page" }),
    ];

    for (const e of entries) await router.apply(e);

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed).sort()).toEqual([
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "timestamp_iso",
        "write_target",
      ]);
    }
  });

  it("each audit line has pm_identity_or_unknown='unknown' (default unauthenticated mode, REQ-NFR-03)", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });

    await router.apply(makeEntry({ screen_id: "AUTH-01", frame_id: "1:1" }));

    const parsed = JSON.parse(readFileSync(env.auditLogPath, "utf8").trim());
    expect(parsed.pm_identity_or_unknown).toBe("unknown");
  });

  it("manifest_entry_hash values are exactly H1, H2, H3 in invocation order", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entries = [
      makeEntry({ screen_id: "AUTH-01", frame_id: "1:1", write_target: "annotation_card" }),
      makeEntry({ screen_id: "DASH-01", frame_id: "2:2", write_target: "comment" }),
      makeEntry({ screen_id: "PROF-01", frame_id: "3:3", write_target: "descriptions_page" }),
    ];
    const expectedHashes = entries.map((e) => computeManifestEntryHash(e));

    for (const e of entries) await router.apply(e);

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    const actualHashes = lines.map((l) => JSON.parse(l).manifest_entry_hash);
    expect(actualHashes).toEqual(expectedHashes);
  });

  it("timestamp_iso matches ISO-8601 UTC regex on every line", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    await router.apply(makeEntry({ screen_id: "AUTH-01", frame_id: "1:1" }));

    const parsed = JSON.parse(readFileSync(env.auditLogPath, "utf8").trim());
    expect(parsed.timestamp_iso).toMatch(ISO_REGEX);
  });
});
