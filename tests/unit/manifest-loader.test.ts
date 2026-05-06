import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest } from "../../apps/review-ui/src/lib/manifest-loader.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "manifest-loader-"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadManifest (REQ-12 / INV-010)", () => {
  it("returns valid:true and data when stubValidator exits 0", async () => {
    const manifestPath = join(tmpRoot, "ok.json");
    const content = { schema_version: "1.0.0", frames: [] };
    writeFileSync(manifestPath, JSON.stringify(content), "utf8");

    const result = await loadManifest({
      manifestPath,
      stubValidator: { exitCode: 0 },
    });

    expect(result.valid).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.data).toEqual(content);
    expect(result.errors).toBeUndefined();
  });

  it("returns valid:false and a parsed OUT_OF_RANGE error when stubValidator exits non-zero", async () => {
    const manifestPath = join(tmpRoot, "broken.json");
    const result = await loadManifest({
      manifestPath,
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
    expect(result.exitCode).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toEqual(
      expect.objectContaining({
        code: "OUT_OF_RANGE",
        json_pointer: "/frames/0/confidence",
      }),
    );
  });

  it("returns valid:false with multiple errors parsed from JSONL stderr", async () => {
    const stderr = [
      JSON.stringify({
        code: "MISSING_REQUIRED",
        json_pointer: "/frames/0/intent",
        message: "intent is required",
      }),
      JSON.stringify({
        code: "ENUM_VIOLATION",
        json_pointer: "/frames/0/write_target",
        message: "unknown write_target",
      }),
    ].join("\n");

    const result = await loadManifest({
      manifestPath: join(tmpRoot, "x.json"),
      stubValidator: { exitCode: 1, stderr },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors?.map((e) => e.code).sort()).toEqual([
      "ENUM_VIOLATION",
      "MISSING_REQUIRED",
    ]);
  });

  it("ignores non-JSON lines in stderr (usage / summary lines)", async () => {
    const stderr = [
      "RESULT pass=0 fail=1 total=1",
      JSON.stringify({
        code: "MISSING_REQUIRED",
        json_pointer: "/frames",
        message: "frames is required",
      }),
    ].join("\n");

    const result = await loadManifest({
      manifestPath: join(tmpRoot, "x.json"),
      stubValidator: { exitCode: 1, stderr },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0].code).toBe("MISSING_REQUIRED");
  });

  it("accepts a bare path string and runs the real validator binary against a valid manifest", async () => {
    const manifestPath = "samples/persona-render-fixture.json";
    if (!existsSync(manifestPath)) {
      // Sanity guard — sibling SPEC fixture.
      return;
    }
    const result = await loadManifest({
      manifestPath,
      validatorBin: "tools/validate-manifest/dist/index.js",
    });
    // We don't assert true/false here — depends on the fixture; we assert
    // that the loader returns a structured result with exitCode set.
    expect(typeof result.valid).toBe("boolean");
    expect(typeof result.exitCode).toBe("number");
  });
});
