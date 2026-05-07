// SPEC-FIGMA-007 AC-S10: Web `/api/apply` and `/api/undo` byte-equal contract preservation.
// Linked: REQ-16, NFR-04 | INV: SPEC-FIGMA-004 frozen contract.
//
// This test asserts:
//   (a) the executor (default) WriteRouter.apply path returns the unchanged
//       SPEC-FIGMA-004 5-key WriteResult shape,
//   (b) re-applying the identical entry yields IDEMPOTENT_SKIP via the
//       existing 7-key SKIPPED audit shape,
//   (c) no new file at apps/review-ui/src/app/api/{apply,undo}/route.ts
//       was modified (frozen contract regression — file-level diff guard).

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

import { WriteRouter } from "../../../packages/write-router/src/index.js";
import { ERROR_CODES } from "../../../packages/write-router/src/types.js";
import {
  SUCCESS_KEYS,
  SKIPPED_KEYS,
} from "../../../packages/write-router/src/audit-log.js";
import type {
  ManifestEntry,
  WriteResult,
} from "../../../packages/write-router/src/types.js";

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-LOGIN",
    frame_id: "1:1",
    title: "로그인",
    intent: "Login screen primary CTA",
    user_value: "사용자 인증 게이트",
    success_criteria: "5초 이내 진입",
    states: [],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: ["color/primary/500"],
    variants: ["compact"],
    navigation: [],
    confidence: 0.92,
    intent_mismatch: false,
    source_hash:
      "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
    write_target: "annotation_card",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 100, output_tokens: 50 },
    ...overrides,
  };
}

function makeMockFigma(nodeId = "7:42") {
  return {
    createText: vi.fn(async () => ({ nodeId })),
    deleteNode: vi.fn(async () => undefined),
  };
}

describe("AC-S10: Web /api/apply /api/undo executor mode byte-equal regression", () => {
  it("WriteRouter.apply (default executor mode) returns the SPEC-FIGMA-004 5-key WriteResult shape", async () => {
    const router = new WriteRouter({ figma: makeMockFigma() });
    const entry = makeEntry();

    const result: WriteResult = await router.apply(entry);

    // Set equality of the 5-key WriteResult shape (NFR-04 frozen contract)
    const sortedKeys = Object.keys(result).sort();
    expect(sortedKeys).toEqual(
      ["fallback_used", "node_id", "status", "undo_descriptor", "write_id"].sort(),
    );
    expect(result.status).toBe("applied");
    expect(typeof result.write_id).toBe("string");
    expect(result.write_id).toMatch(/^wr-/);
    expect(result.fallback_used).toBe(false);
    expect(result.undo_descriptor).toEqual({
      type: "delete-node",
      node_id: "7:42",
    });
    expect(result.node_id).toBe("7:42");
  });

  it("re-applying the identical entry yields IDEMPOTENT_SKIP via existing 7-key SKIPPED audit shape", async () => {
    const router = new WriteRouter({ figma: makeMockFigma() });
    const entry = makeEntry();

    await router.apply(entry);

    // Second apply with identical entry MUST throw IDEMPOTENT_SKIP — the
    // executor branch behavior is byte-equal preserved (NFR-04).
    let caught: unknown;
    try {
      await router.apply(entry);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe(ERROR_CODES.IDEMPOTENT_SKIP);

    // Audit shape constants are frozen — confirm import surface unchanged.
    expect(Array.from(SUCCESS_KEYS).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );
    expect(SKIPPED_KEYS.length).toBe(7);
    expect(Array.from(SKIPPED_KEYS).sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "reason",
        "status",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );
  });

  it("apps/review-ui/src/app/api/{apply,undo}/route.ts files exist and are not deleted", () => {
    // Frozen contract regression — file-level existence check (REQ-16).
    const applyRoute = resolve(
      process.cwd(),
      "apps/review-ui/src/app/api/apply/route.ts",
    );
    const undoRoute = resolve(
      process.cwd(),
      "apps/review-ui/src/app/api/undo/route.ts",
    );
    expect(existsSync(applyRoute)).toBe(true);
    expect(existsSync(undoRoute)).toBe(true);
  });

  it("git diff against origin/main on /api/apply and /api/undo route.ts is empty (when origin/main is reachable)", () => {
    // Best-effort: in CI / environments without origin/main remote,
    // skip rather than fail. The hard NFR-04 enforcement happens via
    // the project's git pre-merge gate (Gate 2 validation).
    const probe = spawnSync("git", ["rev-parse", "origin/main"], {
      encoding: "utf8",
    });
    if (probe.status !== 0) return;

    const diff = spawnSync(
      "git",
      [
        "diff",
        "origin/main",
        "--",
        "apps/review-ui/src/app/api/apply/route.ts",
        "apps/review-ui/src/app/api/undo/route.ts",
      ],
      { encoding: "utf8" },
    );
    expect(diff.status).toBe(0);
    expect(diff.stdout).toBe("");
  });
});
