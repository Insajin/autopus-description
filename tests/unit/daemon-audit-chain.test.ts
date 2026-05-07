// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-09, AC-S9.
// 3 records P1=alpha, P2=beta, P3=alpha; sha256 equality assertions.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { Daemon } from "../../src/daemon/server.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-audit-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("Audit chain prompt_sha256 (REQ-09, AC-S9)", () => {
  it("3 records with prompts alpha/beta/alpha hash correctly and chain idempotently", async () => {
    const daemon = new Daemon({ transport: "stdio", port: 0, auditDir: workDir });
    await daemon.boot();

    await daemon.emitAudit({ prompt_text: "alpha", response_text: "r1" });
    await daemon.emitAudit({ prompt_text: "beta", response_text: "r2" });
    await daemon.emitAudit({ prompt_text: "alpha", response_text: "r3" });

    const auditPath = join(workDir, "audit.jsonl");
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const recs = lines.map((l) => JSON.parse(l));

    expect(recs[0].prompt_sha256).toBe(sha256("alpha"));
    expect(recs[1].prompt_sha256).toBe(sha256("beta"));
    expect(recs[2].prompt_sha256).toBe(sha256("alpha"));
    expect(recs[0].prompt_sha256).not.toBe(recs[1].prompt_sha256);
    expect(recs[0].prompt_sha256).toBe(recs[2].prompt_sha256);

    await daemon.shutdown();
  });

  it("each record preserves the EmittedAudit base key set (NFR-04 — no new fields)", async () => {
    const daemon = new Daemon({ transport: "stdio", port: 0, auditDir: workDir });
    await daemon.boot();
    await daemon.emitAudit({ prompt_text: "x", response_text: "y" });
    const auditPath = join(workDir, "audit.jsonl");
    const rec = JSON.parse(readFileSync(auditPath, "utf8").trim());
    const required = [
      "batch_id",
      "screen_id",
      "provider",
      "mode",
      "input_tokens",
      "output_tokens",
      "cache_hit",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
      "dynamic_input_tokens",
      "file_id",
      "batch_id_provider",
      "strict_mode_used",
      "provider_sdk_version",
      "prompt_sha256",
      "response_sha256",
      "ts",
    ];
    for (const k of required) {
      expect(rec).toHaveProperty(k);
    }
    await daemon.shutdown();
  });
});
