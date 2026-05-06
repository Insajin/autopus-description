/**
 * AC-S8 — audit log shape
 *
 * Given the read adapter has run against the 30-frame mock fixture and emitted audit.jsonl
 * When each line is parsed as JSON into an entry
 *   And Object.keys(entry).sort() is computed
 * Then every entry's key set equals exactly
 *   ["bytes_transferred","finished_at","frame_id","retries","started_at","status"]
 *  And no key equals token | access_token | figma_token | email | user_id
 *  And every status is in {ok, retry_exhausted, payload_oversize, skipped}
 *  And every started_at/finished_at matches /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
 *  And total entry count equals 30
 *
 * Linked: REQ-22, INV-008
 */
import { describe, it, expect } from "vitest";
import { runReadPipelineToFiles } from "../src/read-pipeline.js";
import { useFigmaAdapter } from "../src/adapters/use-figma-adapter.js";
import { readFileSync } from "node:fs";

const FIXTURE = "fixtures/30-frame-mock/";
const EXPECTED_KEYS = ["bytes_transferred", "finished_at", "frame_id", "retries", "started_at", "status"];
const FORBIDDEN_KEYS = ["token", "access_token", "figma_token", "email", "user_id"];
const VALID_STATUSES = new Set(["ok", "retry_exhausted", "payload_oversize", "skipped"]);
const ISO8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe("AC-S8: audit log shape (exact key set, redacted, status enum, ISO-8601 UTC)", () => {
  async function loadAudit(): Promise<Record<string, unknown>[]> {
    const result = await runReadPipelineToFiles({ adapter: useFigmaAdapter, fixturePath: FIXTURE });
    const text = readFileSync(result.auditPath, "utf8");
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }

  it("every entry's sorted key set equals the SPEC oracle key set", async () => {
    const entries = await loadAudit();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(EXPECTED_KEYS);
    }
  });

  it("no entry contains token | access_token | figma_token | email | user_id", async () => {
    const entries = await loadAudit();
    for (const entry of entries) {
      const keys = Object.keys(entry);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("every status is in {ok, retry_exhausted, payload_oversize, skipped}", async () => {
    const entries = await loadAudit();
    for (const entry of entries) {
      expect(VALID_STATUSES.has(String(entry.status))).toBe(true);
    }
  });

  it("every started_at and finished_at matches ISO-8601 UTC regex", async () => {
    const entries = await loadAudit();
    for (const entry of entries) {
      expect(ISO8601_UTC.test(String(entry.started_at))).toBe(true);
      expect(ISO8601_UTC.test(String(entry.finished_at))).toBe(true);
    }
  });

  it("total number of entries equals 30", async () => {
    const entries = await loadAudit();
    expect(entries.length).toBe(30);
  });
});
