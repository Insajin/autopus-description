// SPEC-FIGMA-007 W2 unit test — daemon-side write audit row writers.
// Linked: REQ-12, REQ-14, REQ-08, REQ-19, REQ-15.
// Asserts strict key sets and frozen-shape contracts (NFR-04).

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DRIFT_ABORT_KEYS,
  REJECTION_KEYS_7,
  UNDO_KEYS,
  SUCCESS_KEYS_5,
  buildDriftAbortRow,
  buildRejectionRow,
  buildSuccessRow,
  buildUndoRow,
  appendAuditDriftAbort,
  appendAuditRejection,
  appendAuditPartialDisconnect,
  appendAuditMissingGate,
  appendAuditPendingExpired,
  appendAuditUndo,
  appendAuditSuccess,
  appendAuditSkipped,
} from "../../src/daemon/write-audit.js";

const COMMON = {
  frame_id: "1:1",
  manifest_entry_hash: "a".repeat(64),
  pm_identity_or_unknown: "designer-1",
  write_target: "annotation_card",
};

describe("daemon write-audit — strict key shapes (REQ-12 / REQ-14 / REQ-08)", () => {
  it("DRIFT_ABORT_KEYS is exactly 9 keys (REQ-12)", () => {
    expect(DRIFT_ABORT_KEYS.length).toBe(9);
    expect([...DRIFT_ABORT_KEYS].sort()).toEqual(
      [
        "frame_id",
        "manifest_entry_hash",
        "pm_identity_or_unknown",
        "reason",
        "source_hash_dryrun",
        "source_hash_recomputed",
        "status",
        "timestamp_iso",
        "write_target",
      ].sort(),
    );
  });

  it("REJECTION_KEYS_7 is exactly 7 keys", () => {
    expect(REJECTION_KEYS_7.length).toBe(7);
  });

  it("UNDO_KEYS equals REJECTION_KEYS_7 (7 keys)", () => {
    expect([...UNDO_KEYS]).toEqual([...REJECTION_KEYS_7]);
  });

  it("SUCCESS_KEYS_5 is exactly 5 keys (frozen SPEC-FIGMA-004 SUCCESS_KEYS)", () => {
    expect(SUCCESS_KEYS_5.length).toBe(5);
  });

  it("buildDriftAbortRow returns exactly 9 keys with status='rejected', reason='APPLY_DRIFT_ABORT'", () => {
    const row = buildDriftAbortRow({
      ...COMMON,
      source_hash_dryrun: "0".repeat(64),
      source_hash_recomputed: "1".repeat(64),
    });
    expect(Object.keys(row).sort()).toEqual([...DRIFT_ABORT_KEYS].sort());
    expect(row.status).toBe("rejected");
    expect(row.reason).toBe("APPLY_DRIFT_ABORT");
    expect(row.source_hash_dryrun).toBe("0".repeat(64));
    expect(row.source_hash_recomputed).toBe("1".repeat(64));
  });

  it("buildRejectionRow returns 7-key row with the provided reason", () => {
    const row = buildRejectionRow({ ...COMMON, reason: "MISSING_DRYRUN_GATE" });
    expect(Object.keys(row).sort()).toEqual([...REJECTION_KEYS_7].sort());
    expect(row.reason).toBe("MISSING_DRYRUN_GATE");
    expect(row.status).toBe("rejected");
  });

  it("buildUndoRow returns 7-key row with status='undone', reason='UNDO_REQUESTED'", () => {
    const row = buildUndoRow(COMMON);
    expect(Object.keys(row).sort()).toEqual([...UNDO_KEYS].sort());
    expect(row.status).toBe("undone");
    expect(row.reason).toBe("UNDO_REQUESTED");
  });

  it("buildSuccessRow returns 5-key row WITHOUT status/reason fields", () => {
    const row = buildSuccessRow(COMMON);
    expect(Object.keys(row).sort()).toEqual([...SUCCESS_KEYS_5].sort());
    expect(row.status).toBeUndefined();
    expect(row.reason).toBeUndefined();
  });
});

describe("daemon write-audit — file persistence + redaction", () => {
  it("appendAuditDriftAbort writes one JSONL line with redacted figd_ tokens", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-test-"));
    const logPath = join(tmp, "write-audit.jsonl");
    try {
      await appendAuditDriftAbort(
        {
          ...COMMON,
          frame_id: "1:1 figd_AAAAAAAAAAAAAAAAAA",
          source_hash_dryrun: "0".repeat(64),
          source_hash_recomputed: "1".repeat(64),
        },
        { logPath },
      );
      const text = readFileSync(logPath, "utf8");
      const lines = text.trim().split("\n");
      expect(lines.length).toBe(1);
      expect(text).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.reason).toBe("APPLY_DRIFT_ABORT");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("appendAuditPartialDisconnect / MissingGate / PendingExpired produce 7-key REJECTION rows with the literal reason", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-test-"));
    const logPath = join(tmp, "write-audit.jsonl");
    try {
      const r1 = await appendAuditPartialDisconnect(COMMON, { logPath });
      const r2 = await appendAuditMissingGate(COMMON, { logPath });
      const r3 = await appendAuditPendingExpired(COMMON, { logPath });
      expect(r1.reason).toBe("APPLY_PARTIAL_DISCONNECT");
      expect(r2.reason).toBe("MISSING_DRYRUN_GATE");
      expect(r3.reason).toBe("PENDING_EXPIRED");
      for (const row of [r1, r2, r3]) {
        expect(Object.keys(row).sort()).toEqual([...REJECTION_KEYS_7].sort());
        expect(row.status).toBe("rejected");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("appendAuditRejection / appendAuditUndo / appendAuditSuccess / appendAuditSkipped append distinct rows in order", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-test-"));
    const logPath = join(tmp, "write-audit.jsonl");
    try {
      await appendAuditSuccess(COMMON, { logPath });
      await appendAuditSkipped({ ...COMMON }, { logPath });
      await appendAuditUndo(COMMON, { logPath });
      await appendAuditRejection({ ...COMMON, reason: "OTHER" }, { logPath });
      const lines = readFileSync(logPath, "utf8").trim().split("\n");
      expect(lines.length).toBe(4);
      // First row is the SUCCESS row — 5 keys (no status/reason).
      const parsed0 = JSON.parse(lines[0]);
      expect(Object.keys(parsed0).sort()).toEqual([...SUCCESS_KEYS_5].sort());
      // Last row is the REJECTION row — has reason="OTHER".
      const parsed3 = JSON.parse(lines[3]);
      expect(parsed3.reason).toBe("OTHER");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
