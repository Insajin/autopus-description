// SPEC-FIGMA-013 T7 / AC-HTTP-2 — Phase 1.5 RED scaffold.
// Maps to: REQ-04.
// ListResources over HTTP wire returns 6 URIs in byte-equal order.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";

// @AX:ANCHOR: [AUTO] Byte-equal resource order is the SPEC-FIGMA-013 HTTP resource contract.
// @AX:REASON: [AUTO] Multiple assertions depend on this tuple to catch resource drift.
const EXPECTED_URIS = [
  "autopus://active_selection",
  "autopus://pending_descriptions",
  "autopus://audit_events",
  "autopus://stale_frames",
  "autopus://pending_writes",
  "autopus://applied_writes",
];

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-2-"));
  harness = await createHttpHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-HTTP-2: ListResources over HTTP wire — 6 URI byte-equal order", () => {
  it("listResources returns exactly 6 entries with URIs byte-equal expected array", async () => {
    const resp = await harness.client.listResources();
    expect(resp.resources).toHaveLength(6);
    expect(resp.resources.map((r) => r.uri)).toEqual(EXPECTED_URIS);
  });

  it("no extra URI beyond the 6-entry baseline (length strictly equals 6)", async () => {
    const resp = await harness.client.listResources();
    const uris = resp.resources.map((r) => r.uri);
    expect(uris.length).toBe(6);
    expect([...uris].sort()).toEqual([...EXPECTED_URIS].sort());
  });
});
