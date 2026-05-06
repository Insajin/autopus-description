import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAuditEntry,
  buildAuditEntry,
  AUDIT_KEYS,
  type AuditEntry,
} from "../../packages/write-router/src/audit-log.js";

let tmpRoot: string;
let logPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "audit-log-test-"));
  logPath = join(tmpRoot, "audit.log");
  delete process.env.AUDIT_LOG_PATH;
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.AUDIT_LOG_PATH;
});

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    frame_id: "1:1",
    write_target: "annotation_card",
    timestamp_iso: "2026-05-06T12:34:56.000Z",
    pm_identity_or_unknown: "unknown",
    manifest_entry_hash: "deadbeef".repeat(8),
    ...overrides,
  };
}

describe("appendAuditEntry (REQ-11 / REQ-NFR-05 / INV-009)", () => {
  it("writes exactly 5 keys per record in JSON Lines format", async () => {
    await appendAuditEntry(entry({ frame_id: "a:1" }), { logPath });
    await appendAuditEntry(entry({ frame_id: "b:2" }), { logPath });
    await appendAuditEntry(entry({ frame_id: "c:3" }), { logPath });

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed).sort()).toEqual([...AUDIT_KEYS].sort());
    }
  });

  it("appends — does not truncate previous entries", async () => {
    await appendAuditEntry(entry({ frame_id: "a:1" }), { logPath });
    await appendAuditEntry(entry({ frame_id: "b:2" }), { logPath });
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]).frame_id).toBe("a:1");
    expect(JSON.parse(lines[1]).frame_id).toBe("b:2");
  });

  it("each line ends with a newline (\\n)", async () => {
    await appendAuditEntry(entry(), { logPath });
    const raw = readFileSync(logPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("rejects entries with extra keys (defensive guard)", async () => {
    const bad = { ...entry(), unexpected: "x" } as unknown as AuditEntry;
    await expect(appendAuditEntry(bad, { logPath })).rejects.toThrow(
      /must contain exactly/,
    );
  });

  it("rejects entries with missing keys (defensive guard)", async () => {
    const partial = {
      frame_id: "1:1",
      write_target: "annotation_card",
      timestamp_iso: "2026-05-06T00:00:00Z",
      // missing pm_identity_or_unknown and manifest_entry_hash
    } as unknown as AuditEntry;
    await expect(appendAuditEntry(partial, { logPath })).rejects.toThrow(
      /must contain exactly/,
    );
  });

  it("redacts Figma personal access tokens in any string field", async () => {
    const tokenized = entry({
      pm_identity_or_unknown: "figd_TESTTOKEN1234567890ABCDEF",
    });
    await appendAuditEntry(tokenized, { logPath });
    const content = readFileSync(logPath, "utf8");
    expect(content).not.toMatch(/figd_TESTTOKEN1234567890ABCDEF/);
    expect(content).toContain("<REDACTED>");
  });

  it("falls back to AUDIT_LOG_PATH env var when no logPath option is given", async () => {
    process.env.AUDIT_LOG_PATH = logPath;
    await appendAuditEntry(entry());
    expect(existsSync(logPath)).toBe(true);
  });
});

describe("buildAuditEntry", () => {
  it("returns a copy of the entry when key set is exact", () => {
    const e = entry();
    const built = buildAuditEntry(e);
    expect(built).toEqual(e);
    expect(built).not.toBe(e);
  });

  it("throws if key set is wrong", () => {
    expect(() =>
      buildAuditEntry({ ...entry(), extra: 1 } as unknown as AuditEntry),
    ).toThrow();
  });
});
