// SPEC-FIGMA-004 Phase 3 — edge-case coverage beyond AC oracles.
// Concurrent applies, malformed JSON manifest, none adapter happy path,
// registry edge paths, 30-frame batch.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WriteRouter, AdapterRegistry } from "@autopus/write-router";
import { applyNone, undoNone, noneAdapter } from "@autopus/write-router/adapters/none";
import { loadManifest } from "@autopus/review-ui/lib/manifest-loader";

import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  env.cleanup();
});

describe("edge: concurrent applies on distinct entries serialize without dropping audit lines", () => {
  it("Promise.all over 5 distinct entries appends exactly 5 audit lines", async () => {
    const router = new WriteRouter({ auditLogPath: env.auditLogPath });
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({
        screen_id: `S-${i}`,
        frame_id: `${i}:0`,
        write_target: "none",
        source_hash: `h-${i}`,
      }),
    );

    await Promise.all(entries.map((e) => router.apply(e)));

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(5);
    const screenIds = lines
      .map((l) => JSON.parse(l).frame_id)
      .sort();
    expect(screenIds).toEqual(["0:0", "1:0", "2:0", "3:0", "4:0"]);
  });
});

describe("edge: none adapter (REQ-04(f), broadcast-only path)", () => {
  it("applyNone resolves to undo_descriptor type='noop' and fallback_used=false", async () => {
    const result = await applyNone(makeEntry({ write_target: "none" }), {});
    expect(result.undo_descriptor).toEqual({ type: "noop" });
    expect(result.fallback_used).toBe(false);
  });

  it("undoNone resolves without throwing (no-op)", async () => {
    await expect(undoNone({ type: "noop" }, {})).resolves.toBeUndefined();
  });

  it("noneAdapter object dispatches to applyNone and undoNone", async () => {
    const result = await noneAdapter.apply(makeEntry({ write_target: "none" }), {});
    expect(result.undo_descriptor.type).toBe("noop");
    await expect(noneAdapter.undo({ type: "noop" }, {})).resolves.toBeUndefined();
  });

  it("router routing 'none' invokes 0 Figma APIs and registers 'noop' undo descriptor", async () => {
    const router = new WriteRouter({ auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "none" });
    const result = await router.apply(entry);
    expect(result.status).toBe("applied");
    expect(result.undo_descriptor).toEqual({ type: "noop" });
  });
});

describe("edge: AdapterRegistry behavior", () => {
  it("listAdapters returns all 8 known WriteTarget enum values", () => {
    const router = new WriteRouter({ auditLogPath: env.auditLogPath });
    const targets = router.listAdapters().sort();
    expect(targets).toEqual([
      "annotation_card",
      "comment",
      "descriptions_page",
      "frame_name",
      "native_annotation",
      // SPEC-FIGMA-020 T1 — composite dual-write target widened WriteTarget.
      "native_annotation_with_card",
      "none",
      "plugin_data",
    ]);
  });

  it("AdapterRegistry.has returns true for every known target and false for unknown", () => {
    const reg = new AdapterRegistry();
    expect(reg.has("annotation_card")).toBe(true);
    expect(reg.has("none")).toBe(true);
    expect(reg.has("descriptions_page")).toBe(true);
    expect(reg.has("comment")).toBe(true);
    expect(reg.has("plugin_data")).toBe(true);
    expect(reg.has("frame_name")).toBe(true);
    expect(reg.has("native_annotation")).toBe(true);
    // SPEC-FIGMA-020 T1 — the composite target is registered alongside the rest.
    expect(reg.has("native_annotation_with_card")).toBe(true);
    expect(reg.size()).toBe(8);
  });

  it("router throws WRITE_TARGET_ROUTING_ERROR on unknown write_target enum value", async () => {
    const router = new WriteRouter({ auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "unknown_target" as never });
    const err = await router.apply(entry).catch((e) => e);
    expect((err as { code?: string }).code).toBe("WRITE_TARGET_ROUTING_ERROR");
  });
});

describe("edge: manifest loader handles malformed and missing inputs", () => {
  it("returns valid:false with empty errors array when stub validator emits non-JSON stderr", async () => {
    const result = await loadManifest({
      manifestPath: "/tmp/anything.json",
      stubValidator: { exitCode: 1, stderr: "FATAL: usage error\n" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(1);
  });

  it("returns valid:false with parsed errors when stub validator emits JSON Lines", async () => {
    const errs = [
      JSON.stringify({ code: "MISSING_REQUIRED", json_pointer: "/frames/0/intent", message: "" }),
      JSON.stringify({ code: "OUT_OF_RANGE", json_pointer: "/frames/1/confidence", message: "1.5" }),
    ].join("\n");
    const result = await loadManifest({
      manifestPath: "/tmp/anything.json",
      stubValidator: { exitCode: 1, stderr: errs },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors?.[0].code).toBe("MISSING_REQUIRED");
    expect(result.errors?.[1].code).toBe("OUT_OF_RANGE");
  });

  it("returns valid:true with parsed manifestContent when stub validator passes", async () => {
    const manifest = { frames: [{ screen_id: "AUTH-01" }] };
    const result = await loadManifest({
      manifestPath: "/tmp/whatever.json",
      stubValidator: { exitCode: 0 },
      manifestContent: manifest,
    });
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(manifest);
  });

  it("loads manifest data from disk when stubValidator passes and manifestContent is not provided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "manifest-loader-"));
    const path = join(tmp, "m.json");
    writeFileSync(path, JSON.stringify({ frames: [{ screen_id: "DISK-01" }] }), "utf8");
    try {
      const result = await loadManifest({
        manifestPath: path,
        stubValidator: { exitCode: 0 },
      });
      expect(result.valid).toBe(true);
      expect((result.data as { frames: { screen_id: string }[] }).frames[0].screen_id).toBe("DISK-01");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns valid:true with data:undefined when manifest file is unreadable", async () => {
    const result = await loadManifest({
      manifestPath: "/nonexistent/path/manifest.json",
      stubValidator: { exitCode: 0 },
    });
    expect(result.valid).toBe(true);
    expect(result.data).toBeUndefined();
  });
});

describe("edge: 30-frame batch apply with mixed write_target distribution", () => {
  it("applies 30 'none' entries and audit log records exactly 30 success lines", async () => {
    const router = new WriteRouter({ auditLogPath: env.auditLogPath });
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({
        screen_id: `BATCH-${i}`,
        frame_id: `${i}:batch`,
        write_target: "none",
        source_hash: `bh-${i}`,
      }),
    );

    const results = await Promise.allSettled(entries.map((e) => router.apply(e)));
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(30);

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(30);
    const frameIds = lines.map((l) => JSON.parse(l).frame_id).sort();
    expect(frameIds[0]).toBe("0:batch");
    expect(frameIds[frameIds.length - 1]).toBe("9:batch");
  });
});
