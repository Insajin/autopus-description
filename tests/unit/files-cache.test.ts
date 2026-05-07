// SPEC-FIGMA-005 T12 / AC-S3, AC-S4: FileIdCache contract.
// REQ-04, REQ-21. screenshot_sha256 → file_id deterministic mapping with
// dedup count and persistence under .audit/<batch_id>/file-id-map.json.

import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileIdCache } from "../../src/providers/files-cache.js";

const tmpDirs: string[] = [];

afterEach(() => {
  // Best-effort cleanup; vitest run is short and tmpfs auto-collects.
});

function makeAuditDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "figma005-files-cache-"));
  tmpDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("FileIdCache (AC-S3, AC-S4)", () => {
  it("get/set is deterministic for the same sha256", () => {
    const c = new FileIdCache();
    c.set("sha256_A", "file_aaa");
    expect(c.get("sha256_A")).toBe("file_aaa");
    expect(c.get("sha256_A")).toBe("file_aaa");
    // setting the same sha256 again is a no-op (immutable mapping)
    c.set("sha256_A", "file_DIFFERENT");
    expect(c.get("sha256_A")).toBe("file_aaa");
  });

  it("AC-S4 dedup count: 10 lookups across 5 unique sha256 ⇒ dedup=5", () => {
    const c = new FileIdCache();
    const calls: Array<[string, string]> = [
      ["A", "file_A"],
      ["A", "file_A"],
      ["A", "file_A"],
      ["B", "file_B"],
      ["B", "file_B"],
      ["C", "file_C"],
      ["C", "file_C"],
      ["D", "file_D"],
      ["D", "file_D"],
      ["E", "file_E"],
    ];
    for (const [sha, fid] of calls) {
      const cached = c.get(sha);
      if (!cached) c.set(sha, fid);
    }
    expect(c.size()).toBe(5);
    expect(c.getDedupCount()).toBe(5);
  });

  it("AC-S3 paired matching: same sha256 ⇒ same file_id across calls", () => {
    const c = new FileIdCache();
    const sha = "abc123def456";
    const cached1 = c.get(sha);
    expect(cached1).toBeUndefined();
    c.set(sha, "file_xyz789");
    const cached2 = c.get(sha);
    const cached3 = c.get(sha);
    expect(cached2).toBe("file_xyz789");
    expect(cached3).toBe("file_xyz789");
  });

  it("persist writes file-id-map.json under .audit/<batch_id>/", () => {
    const c = new FileIdCache();
    c.set("sha_A", "file_A");
    c.set("sha_B", "file_B");
    c.set("sha_C", "file_C");
    c.set("sha_D", "file_D");
    c.set("sha_E", "file_E");
    const audit_dir = makeAuditDir();
    const batch_id = "batch_test_001";
    const path = c.persist(audit_dir, batch_id);
    expect(path).toContain("file-id-map.json");
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as {
      schema_version: string;
      batch_id: string;
      entries: Record<string, { file_id: string }>;
    };
    expect(parsed.schema_version).toBe("1.0");
    expect(parsed.batch_id).toBe(batch_id);
    expect(Object.keys(parsed.entries).sort()).toEqual([
      "sha_A",
      "sha_B",
      "sha_C",
      "sha_D",
      "sha_E",
    ]);
    expect(parsed.entries.sha_A.file_id).toBe("file_A");
  });

  it("load restores a previously persisted map", () => {
    const audit_dir = makeAuditDir();
    const batch_id = "batch_load_001";
    const a = new FileIdCache();
    a.set("sha_X", "file_X");
    a.set("sha_Y", "file_Y");
    a.persist(audit_dir, batch_id);

    const b = new FileIdCache();
    b.load(audit_dir, batch_id);
    expect(b.size()).toBe(2);
    expect(b.get("sha_X")).toBe("file_X");
    expect(b.get("sha_Y")).toBe("file_Y");
  });

  it("load on missing file is a silent no-op (cold start safe)", () => {
    const audit_dir = makeAuditDir();
    const c = new FileIdCache();
    expect(() => c.load(audit_dir, "no_such_batch")).not.toThrow();
    expect(c.size()).toBe(0);
  });
});
