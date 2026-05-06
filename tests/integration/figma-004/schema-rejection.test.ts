// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S11 schema rejection blocks apply.
// REQ-12, INV-010.

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { WriteRouter } from "@autopus/write-router";
import { loadManifest } from "@autopus/review-ui/lib/manifest-loader";

import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  env.cleanup();
});

describe("AC-S11: schema rejection blocks apply (REQ-12)", () => {
  it("loadManifest returns valid=false with OUT_OF_RANGE error citing /frames/0/confidence", async () => {
    const result = await loadManifest({
      manifestPath: `${env.tmpRoot}/invalid.json`,
      stubValidator: {
        exitCode: 1,
        stderr: JSON.stringify({
          code: "OUT_OF_RANGE",
          json_pointer: "/frames/0/confidence",
          message: "confidence 1.5 outside [0.0, 1.0]",
        }),
      },
      manifestContent: { frames: [{ screen_id: "AUTH-01", confidence: 1.5 }] },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "OUT_OF_RANGE",
        json_pointer: "/frames/0/confidence",
      }),
    ]);
  });

  it("router rejects with MANIFEST_INVALID and invokes 0 Figma write APIs when manifest is invalid", async () => {
    const server = createMockFigmaWriteServer();
    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath, valid: false });
    const entry = makeEntry({ write_target: "annotation_card" });

    const err = await router.apply(entry).catch((e) => e);

    expect((err as { code?: string }).code).toBe("MANIFEST_INVALID");
    expect(server.calls.createText).toHaveLength(0);
    expect(server.calls.commentPost).toHaveLength(0);
    expect(server.calls.setFrameName).toHaveLength(0);
    expect(server.calls.setPluginData).toHaveLength(0);
  });
});
