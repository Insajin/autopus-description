// SPEC-FIGMA-007 W2 unit test — audit retention guard.
// Linked: REQ-10 (daemon-side wrapping of frozen emitAuditRecord), NFR-03.
// Asserts DEBUG=true raw file contains zero figd_/xoxb-/bearer/absolute-path matches.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emitAuditRecordWithRetentionGuard } from "../../src/daemon/audit-retention-guard.js";
import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
} from "../../src/redact-patterns.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "audit-guard-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.DEBUG;
});

const SECRET =
  "My token is figd_AAAAAAAAAAAAAAAA and slack xoxb-1234567890123456 with Bearer aaaaaaaaaaaaaaaaaa from /Users/secret/path";

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

describe("emitAuditRecordWithRetentionGuard — REQ-10 / NFR-03 contract", () => {
  it("returns an EmittedAudit with prompt_sha256 matching 64-hex regex", async () => {
    const audit = await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        prompt_text: "hello",
        response_text: "world",
      },
      join(workDir, ".audit"),
    );
    expect(audit.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("identical inputs produce byte-equal prompt_sha256 (deterministic chain extension)", async () => {
    const a = await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        prompt_text: "hello",
        response_text: "world",
      },
      join(workDir, ".audit"),
    );
    const b = await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-002",
        screen_id: "FRAME-02",
        prompt_text: "hello",
        response_text: "world",
      },
      join(workDir, ".audit"),
    );
    expect(b.prompt_sha256).toBe(a.prompt_sha256);
  });

  it("appends one JSON line to <audit_dir>/<batch_id>/calls.jsonl", async () => {
    await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        prompt_text: "hello",
        response_text: "world",
      },
      join(workDir, ".audit"),
    );
    const callsPath = join(workDir, ".audit", "batch-001", "calls.jsonl");
    expect(existsSync(callsPath)).toBe(true);
    const lines = readFileSync(callsPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("DEBUG=true: raw file is written and contains zero figd_/xoxb-/bearer matches", async () => {
    process.env.DEBUG = "true";
    await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        prompt_text: SECRET,
        response_text: SECRET,
      },
      join(workDir, ".audit"),
    );
    const raw = findRawFiles(join(workDir, ".audit"));
    expect(raw.length).toBe(1);
    const text = readFileSync(raw[0], "utf8");
    expect(text).not.toMatch(new RegExp(FIGD_PATTERN_SOURCE));
    expect(text).not.toMatch(new RegExp(XOXB_PATTERN_SOURCE));
    expect(text).not.toMatch(new RegExp(BEARER_PATTERN_SOURCE));
  });

  it("DEBUG=true: raw file zero-matches every absolute-path prefix in ABSOLUTE_PATH_PATTERNS_SOURCE", async () => {
    process.env.DEBUG = "true";
    await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        prompt_text: SECRET,
        response_text: SECRET,
      },
      join(workDir, ".audit"),
    );
    const raw = findRawFiles(join(workDir, ".audit"));
    const text = readFileSync(raw[0], "utf8");
    for (const p of ABSOLUTE_PATH_PATTERNS_SOURCE) {
      expect(text).not.toMatch(new RegExp(p));
    }
  });

  it("DEBUG unset: raw file is NOT written (calls.jsonl only)", async () => {
    delete process.env.DEBUG;
    await emitAuditRecordWithRetentionGuard(
      {
        batch_id: "batch-001",
        screen_id: "FRAME-01",
        prompt_text: SECRET,
        response_text: SECRET,
      },
      join(workDir, ".audit"),
    );
    expect(findRawFiles(join(workDir, ".audit")).length).toBe(0);
    expect(
      existsSync(join(workDir, ".audit", "batch-001", "calls.jsonl")),
    ).toBe(true);
  });

  // SEC-007-M1 — identifier allowlist guard against path traversal.
  describe("identifier shape validation (SEC-007-M1)", () => {
    it.each([
      ["batch_id with ../", { batch_id: "../escape", screen_id: "FRAME-01", mode: "node-only" as const }],
      ["batch_id with /", { batch_id: "batch/sub", screen_id: "FRAME-01", mode: "node-only" as const }],
      ["screen_id with ..", { batch_id: "batch-001", screen_id: "..", mode: "node-only" as const }],
      ["screen_id with /", { batch_id: "batch-001", screen_id: "FRAME/01", mode: "node-only" as const }],
      ["empty batch_id", { batch_id: "", screen_id: "FRAME-01", mode: "node-only" as const }],
    ])("rejects %s with shape violation error", async (_label, ids) => {
      await expect(
        emitAuditRecordWithRetentionGuard(
          {
            batch_id: ids.batch_id,
            screen_id: ids.screen_id,
            mode: ids.mode,
            prompt_text: "ok",
            response_text: "ok",
          },
          join(workDir, ".audit"),
        ),
      ).rejects.toThrow(/identifier shape violation/);
    });

    it("accepts safe identifiers (alphanumerics, underscore, hyphen, dot)", async () => {
      await expect(
        emitAuditRecordWithRetentionGuard(
          {
            batch_id: "batch-001.v2",
            screen_id: "FRAME_01",
            mode: "node-only",
            prompt_text: "ok",
            response_text: "ok",
          },
          join(workDir, ".audit"),
        ),
      ).resolves.toBeDefined();
    });
  });
});
