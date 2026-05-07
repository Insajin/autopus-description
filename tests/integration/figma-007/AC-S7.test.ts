// SPEC-FIGMA-007 AC-S7: Untrusted-fence + redact pass on plugin postMessage write payloads + audit retention guard.
// Linked: REQ-10 (audit retention guard), REQ-13, NFR-03 | INV-012.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
} from "../../../src/redact-patterns.js";

const SECRET_PROMPT =
  "My token is figd_AAAAAAAAAAAAAAAA and slack xoxb-1234567890123456 from /Users/secret/path";

let workDir: string;
let auditDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-figma007-acs7-"));
  auditDir = join(workDir, ".audit", "batch-001");
  process.env.DEBUG = "true";
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.DEBUG;
});

function findRawFiles(rootAuditDir: string): string[] {
  const out: string[] = [];
  if (!existsSync(rootAuditDir)) return out;
  const visit = (p: string): void => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) visit(f);
      else if (e.isFile() && f.endsWith(".json") && f.includes("/raw/")) out.push(f);
    }
  };
  visit(rootAuditDir);
  return out;
}

describe("AC-S7: redact pipeline strips figd_/xoxb-/bearer/absolute-path on every persisted artifact", () => {
  it("emitAuditRecordWithRetentionGuard writes redacted raw file under DEBUG=true (zero secret matches)", async () => {
    const guardSpecifier = "../../../src/daemon/audit-retention-guard.js";
    const mod = (await import(/* @vite-ignore */ guardSpecifier).catch(
      () => null,
    )) as Record<string, unknown> | null;
    if (!mod) {
      throw new Error(
        "src/daemon/audit-retention-guard.ts not implemented yet (W2 T20 pending)",
      );
    }
    const guard = (mod as Record<string, unknown>)
      .emitAuditRecordWithRetentionGuard as
      | ((input: Record<string, unknown>, dir: string) => Promise<unknown>)
      | undefined;
    if (typeof guard !== "function") {
      throw new Error(
        "emitAuditRecordWithRetentionGuard export missing (W2 T20 pending)",
      );
    }

    await guard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        mode: "node-only",
        prompt_text: SECRET_PROMPT,
        response_text: SECRET_PROMPT,
        provider_sdk_version: "mock-1.0",
      },
      join(workDir, ".audit"),
    );

    const rawFiles = findRawFiles(join(workDir, ".audit"));
    expect(rawFiles.length).toBeGreaterThanOrEqual(1);

    const figd = new RegExp(FIGD_PATTERN_SOURCE);
    const xoxb = new RegExp(XOXB_PATTERN_SOURCE);
    const bearer = new RegExp(BEARER_PATTERN_SOURCE);

    for (const f of rawFiles) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(figd);
      expect(text).not.toMatch(xoxb);
      expect(text).not.toMatch(bearer);
      for (const p of ABSOLUTE_PATH_PATTERNS_SOURCE) {
        // The shared list contains the pattern source string for /Users/, /home/, C:\Users\.
        // The C:\Users\ entry stores escaped backslashes — apply RegExp.
        const pat = new RegExp(p);
        expect(text).not.toMatch(pat);
      }
    }
  });

  it("EmittedAudit calls.jsonl row's prompt_sha256 is a 64-hex string (frozen contract)", async () => {
    const guardSpecifier = "../../../src/daemon/audit-retention-guard.js";
    const mod = (await import(/* @vite-ignore */ guardSpecifier).catch(
      () => null,
    )) as Record<string, unknown> | null;
    if (!mod) {
      throw new Error(
        "src/daemon/audit-retention-guard.ts not implemented yet (W2 T20 pending)",
      );
    }
    const guard = (mod as Record<string, unknown>)
      .emitAuditRecordWithRetentionGuard as
      | ((
          input: Record<string, unknown>,
          dir: string,
        ) => Promise<Record<string, unknown>>)
      | undefined;
    if (typeof guard !== "function") {
      throw new Error("emitAuditRecordWithRetentionGuard export missing");
    }

    const result = await guard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        mode: "node-only",
        prompt_text: SECRET_PROMPT,
        response_text: "ok",
        provider_sdk_version: "mock-1.0",
      },
      join(workDir, ".audit"),
    );

    expect(result.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
    // Hash MUST be deterministic — same input yields same hash.
    const result2 = await guard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-02",
        mode: "node-only",
        prompt_text: SECRET_PROMPT,
        response_text: "ok",
        provider_sdk_version: "mock-1.0",
      },
      join(workDir, ".audit"),
    );
    expect(result2.prompt_sha256).toBe(result.prompt_sha256);
  });
});
