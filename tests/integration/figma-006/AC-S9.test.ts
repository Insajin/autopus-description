// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S9.
// Audit chain prompt_sha256 — alpha/beta/alpha sequence; idempotent hashing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { Daemon } from "../../../src/daemon/server.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autopus-chain-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("AC-S9: audit chain prompt_sha256 differs iff prompt text differs", () => {
  it("3 emitted records satisfy the alpha/beta/alpha hash equalities", async () => {
    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      auditDir: join(workDir, ".autopus"),
    });
    await daemon.boot();

    await daemon.emitAudit({ prompt_text: "alpha", response_text: "r1" });
    await daemon.emitAudit({ prompt_text: "beta", response_text: "r2" });
    await daemon.emitAudit({ prompt_text: "alpha", response_text: "r3" });

    const lines = readFileSync(join(workDir, ".autopus", "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);

    expect(lines[0].prompt_sha256).toBe(sha256("alpha"));
    expect(lines[1].prompt_sha256).toBe(sha256("beta"));
    expect(lines[2].prompt_sha256).toBe(sha256("alpha"));
    expect(lines[0].prompt_sha256).not.toBe(lines[1].prompt_sha256);
    expect(lines[0].prompt_sha256).toBe(lines[2].prompt_sha256);

    // EmittedAudit base fields preserved (no new fields introduced — NFR-04)
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
    for (const r of lines) {
      for (const k of required) {
        expect(r).toHaveProperty(k);
      }
    }

    await daemon.shutdown();
  });
});
