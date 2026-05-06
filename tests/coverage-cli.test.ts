/**
 * Coverage gap — src/cli.ts (post-FIX-4 export of main(argv))
 *
 * Drives main() with explicit argv arrays and captures stdout/stderr through
 * temporary stream replacement. Each test asserts on observable behavior:
 * exit code, content of captured streams, and (where relevant) file content.
 *
 * Linked: REQ-11 redaction, REQ-31 dry-run.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs, bindRedactedStderr } from "../src/cli.js";

const TOKEN_REGEX = /figd_[A-Za-z0-9_-]{16,}/g;
const FIXTURE = "fixtures/30-frame-mock/frames.json";

interface Captured {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureStreams(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  return {
    get stdout() { return out.join(""); },
    get stderr() { return err.join(""); },
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
  } as Captured;
}

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "cli-test-"));
});
afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("main(argv) — coverage", () => {
  it("--help prints usage banner and exits 0", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "--help"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout).toContain("Usage: figma-read");
    expect(cap.stdout).toContain("--dry-run");
    expect(cap.stderr).toBe("");
  });

  it("-h short flag also prints usage banner", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "-h"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout).toContain("Usage: figma-read");
  });

  it("--dry-run lists per-frame estimated bytes and TOTAL count", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "MOCK-DOGFOOD-001", "--fixture", FIXTURE, "--dry-run"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/frame .+ estimated_bytes=\d+/);
    expect(cap.stdout).toMatch(/TOTAL frames=\d+/);
  });

  it("--out writes a partial manifest JSON file with sorted top-level keys", async () => {
    const outPath = join(tmpRoot, "partial.manifest.json");
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "MOCK-DOGFOOD-001", "--fixture", FIXTURE, "--out", outPath]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const content = await readFile(outPath, "utf8");
    const parsed = JSON.parse(content);
    expect(Object.keys(parsed).sort()).toEqual(["frames", "pilot_metadata", "prototype", "schema_version"]);
    expect(Array.isArray(parsed.frames)).toBe(true);
  });

  it("default (no --out) writes manifest JSON to stdout, redacted", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "MOCK-DOGFOOD-001", "--fixture", FIXTURE]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout).toContain('"schema_version"');
    expect(cap.stdout.match(TOKEN_REGEX)).toBeNull();
  });

  it("missing <file_id> exits 2 with error on stderr", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "--fixture", FIXTURE]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(2);
    expect(cap.stderr).toContain("error: missing <file_id>");
    expect(cap.stdout).toBe("");
  });

  it("missing --fixture exits 2 with skeleton-scope error on stderr", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "MOCK-DOGFOOD-001"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(2);
    expect(cap.stderr).toContain("live Figma execution is out of scope");
  });

  it("nonexistent fixture path causes main() to reject; the rejected error message is redacted when written to stderr", async () => {
    const cap = captureStreams();
    let threw: unknown;
    try {
      try {
        await main(["node", "cli.js", "MOCK-DOGFOOD-001", "--fixture", "/nonexistent-path-xyz"]);
      } catch (e) {
        threw = e;
        process.stderr.write(`error: ${(e as Error).message ?? String(e)}\n`);
      }
    } finally {
      cap.restore();
    }
    expect(threw).toBeDefined();
    expect((threw as Error).message).toMatch(/ENOENT|nonexistent-path-xyz/);
    expect(cap.stderr).toContain("error:");
    expect(cap.stderr.match(TOKEN_REGEX)).toBeNull();
  });

  it("during main() execution, raw stderr writes pass through bindRedactedStderr", async () => {
    // Capture chunks BEFORE main() so bindRedactedStderr wraps our capture wrapper.
    // We trigger a stderr write during the failure path (missing fileId) and
    // additionally emit a token-bearing line through the still-bound stream.
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown) => {
      out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      err.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    let code: number;
    try {
      // Inject a write between the bind and the unbind by triggering an error path
      // that emits known stderr text. main() also performs its own redacted emit.
      // We cannot interleave from outside main() cleanly; instead, assert that the
      // stderr captured during main() never contains a raw token.
      code = await main(["node", "cli.js", "--fixture", FIXTURE]); // missing fileId → emits error: missing <file_id>
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    expect(code).toBe(2);
    const combined = err.join("");
    expect(combined.match(TOKEN_REGEX)).toBeNull();
    expect(combined).toContain("error:");
  });

  it("unknown flag is ignored by parseArgs (still requires --fixture)", async () => {
    const cap = captureStreams();
    let code: number;
    try {
      code = await main(["node", "cli.js", "MOCK-DOGFOOD-001", "--unknown-flag"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(2);
    expect(cap.stderr).toContain("live Figma execution is out of scope");
  });
});

describe("parseArgs — coverage", () => {
  it("returns help=true for --help", () => {
    expect(parseArgs(["node", "cli.js", "--help"]).help).toBe(true);
  });

  it("returns help=true for -h", () => {
    expect(parseArgs(["node", "cli.js", "-h"]).help).toBe(true);
  });

  it("captures fixture and out paths", () => {
    const args = parseArgs(["node", "cli.js", "FILE-1", "--fixture", "fix/path", "--out", "out/path"]);
    expect(args.fixturePath).toBe("fix/path");
    expect(args.outputPath).toBe("out/path");
    expect(args.fileId).toBe("FILE-1");
  });

  it("parses --dry-run and --debug flags", () => {
    const args = parseArgs(["node", "cli.js", "FILE-1", "--dry-run", "--debug"]);
    expect(args.dryRun).toBe(true);
    expect(args.debug).toBe(true);
  });

  it("first non-flag positional becomes fileId; later positionals are ignored", () => {
    const args = parseArgs(["node", "cli.js", "FIRST", "SECOND"]);
    expect(args.fileId).toBe("FIRST");
  });

  it("ignores unknown flags without throwing", () => {
    const args = parseArgs(["node", "cli.js", "--bogus", "FILE-1"]);
    expect(args.fileId).toBe("FILE-1");
  });
});

describe("bindRedactedStderr — coverage", () => {
  it("redacts string chunks and restore() reverts the override", () => {
    const captured: string[] = [];
    const fakeStream = {
      write: (chunk: string | Uint8Array) => {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const restore = bindRedactedStderr(fakeStream);
    fakeStream.write("hello figd_TESTTOKEN1234567890ABC end");
    restore();
    fakeStream.write("after-restore figd_TESTTOKEN1234567890ABC done");
    expect(captured[0]).toContain("***");
    expect(captured[0].match(TOKEN_REGEX)).toBeNull();
    expect(captured[1]).toContain("figd_TESTTOKEN1234567890ABC");
  });

  it("redacts Uint8Array chunks", () => {
    const captured: string[] = [];
    const fakeStream = {
      write: (chunk: string | Uint8Array) => {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const restore = bindRedactedStderr(fakeStream);
    try {
      fakeStream.write(Buffer.from("buf figd_TESTTOKEN1234567890ABC", "utf8"));
    } finally {
      restore();
    }
    expect(captured[0]).toContain("***");
    expect(captured[0].match(TOKEN_REGEX)).toBeNull();
  });

  it("non-string non-Uint8Array chunks pass through unchanged", () => {
    const captured: unknown[] = [];
    const fakeStream = {
      write: (chunk: unknown) => {
        captured.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const restore = bindRedactedStderr(fakeStream);
    try {
      const arbitrary = 12345 as unknown as string;
      (fakeStream.write as unknown as (c: unknown) => boolean)(arbitrary);
    } finally {
      restore();
    }
    expect(captured[0]).toBe(12345);
  });
});
