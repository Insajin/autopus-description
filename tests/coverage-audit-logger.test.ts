/**
 * Coverage gap — src/audit-logger.ts (assertEntryShape branches, BufferSink, nowIso)
 */
import { describe, it, expect } from "vitest";
import { AuditLogger, BufferSink, nowIso, AUDIT_KEYS } from "../src/audit-logger.js";

describe("AuditLogger — coverage", () => {
  function validEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      frame_id: "FR-01",
      started_at: "2026-05-06T10:00:00Z",
      finished_at: "2026-05-06T10:00:01Z",
      retries: 0,
      bytes_transferred: 12345,
      status: "ok" as const,
      ...overrides,
    };
  }

  it("AUDIT_KEYS is the sorted oracle key set", () => {
    expect(AUDIT_KEYS).toEqual(["bytes_transferred", "finished_at", "frame_id", "retries", "started_at", "status"]);
  });

  it("emits a JSON line with redacted token contents", () => {
    const sink = new BufferSink();
    const log = new AuditLogger(sink);
    log.log({ ...validEntry(), frame_id: "auth=figd_TESTTOKEN1234567890" } as never);
    const line = sink.lines[0];
    expect(line).toContain("***");
    expect(line).not.toContain("figd_TESTTOKEN1234567890");
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(AUDIT_KEYS);
  });

  it("BufferSink.toJsonl concatenates all lines", () => {
    const sink = new BufferSink();
    const log = new AuditLogger(sink);
    log.log(validEntry() as never);
    log.log({ ...validEntry(), frame_id: "FR-02" } as never);
    const combined = sink.toJsonl();
    expect(combined.split("\n").filter((l) => l).length).toBe(2);
  });

  it("rejects entry with extra key", () => {
    const sink = new BufferSink();
    const log = new AuditLogger(sink);
    expect(() => log.log({ ...validEntry(), extra: "x" } as never)).toThrow(/key set mismatch/);
  });

  it("rejects entry missing a required key", () => {
    const sink = new BufferSink();
    const log = new AuditLogger(sink);
    const entry = { ...validEntry() } as Record<string, unknown>;
    delete entry.status;
    expect(() => log.log(entry as never)).toThrow(/key set mismatch/);
  });

  it("rejects non-ISO-8601 started_at", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), started_at: "2026/05/06" } as never)).toThrow(/started_at must be ISO-8601/);
  });

  it("rejects non-ISO-8601 finished_at", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), finished_at: "later" } as never)).toThrow(/finished_at must be ISO-8601/);
  });

  it("rejects invalid status enum value", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), status: "weird" } as never)).toThrow(/invalid status/);
  });

  it("rejects negative retries", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), retries: -1 } as never)).toThrow(/retries must be non-negative/);
  });

  it("rejects non-finite retries", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), retries: Number.POSITIVE_INFINITY } as never)).toThrow(/retries must be non-negative/);
  });

  it("rejects negative bytes_transferred", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), bytes_transferred: -5 } as never)).toThrow(/bytes_transferred must be non-negative/);
  });

  it("rejects non-finite bytes_transferred", () => {
    const log = new AuditLogger(new BufferSink());
    expect(() => log.log({ ...validEntry(), bytes_transferred: Number.NaN } as never)).toThrow(/bytes_transferred must be non-negative/);
  });

  it("accepts all four valid status values", () => {
    const sink = new BufferSink();
    const log = new AuditLogger(sink);
    for (const s of ["ok", "retry_exhausted", "payload_oversize", "skipped"] as const) {
      log.log({ ...validEntry(), status: s } as never);
    }
    expect(sink.lines.length).toBe(4);
  });

  it("nowIso returns ISO-8601 UTC without milliseconds", () => {
    const fixed = new Date("2026-05-06T10:11:12.345Z");
    expect(nowIso(fixed)).toBe("2026-05-06T10:11:12Z");
  });

  it("nowIso with no arg uses current time", () => {
    const out = nowIso();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
