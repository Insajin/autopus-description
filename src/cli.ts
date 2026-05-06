#!/usr/bin/env node
import { redact } from "./token-redactor.js";
import { buildPipelineFromFixture, runPipelineFromFixture } from "./pipeline.js";

/**
 * SPEC-FIGMA-002 CLI entry: `figma-read <file_id> [--dry-run] [--debug] [--fixture <path>]`.
 *
 * REQ-31 (Nice): --dry-run lists frames + estimated payload sizes without exporting.
 * REQ-11: stdout/stderr pass through redactor.
 * Live Figma calls are out of scope for this skeleton — `--fixture <path>` runs against
 * a deterministic mock fixture (the AC-S6/S7/S8 oracle path).
 *
 * SECURITY (FIX-11, SPEC-FIGMA-002 §8 Constraints):
 *   - The `--fixture <path>` and `--out <path>` arguments are operator-controlled.
 *     This CLI does NOT enforce any path sandboxing beyond what the host file
 *     system semantics impose; an operator passing a path outside the project
 *     root will write/read at that path. This is by design — the figma-read
 *     CLI runs in trusted CI/dev environments and the operator owns path
 *     selection. Untrusted users MUST NOT be granted shell access to this CLI.
 *   - Every byte written to stdout/stderr passes through `redact()` so Figma
 *     personal-access tokens (figd_…) and bearer tokens cannot leak through
 *     either standard stream. This includes unhandled-rejection paths: the
 *     top-level main().catch handler routes the error message through
 *     `redact()` before writing to stderr.
 *   - REQ-11: the auth token is sourced from environment variables and is
 *     never echoed in CLI output. Defense-in-depth: redact() masks any token
 *     pattern that nonetheless reaches the streams.
 */

interface Args {
  readonly fileId: string;
  readonly dryRun: boolean;
  readonly debug: boolean;
  readonly fixturePath?: string;
  readonly outputPath?: string;
  readonly help: boolean;
}

const HELP = `Usage: figma-read <file_id> [--dry-run] [--debug] [--fixture <path>] [--out <path>]

Options:
  --dry-run        List frames + size estimates only (REQ-31).
  --debug          Verbose stdout (still token-redacted).
  --fixture PATH   Run against a local fixture instead of the live Figma API.
  --out PATH       Write the partial manifest JSON to PATH (default: stdout).
  --help, -h       Show this help and exit 0.
`;

export function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let fileId = "";
  let dryRun = false;
  let debug = false;
  let fixturePath: string | undefined;
  let outputPath: string | undefined;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--debug") debug = true;
    else if (a === "--fixture") fixturePath = args[++i];
    else if (a === "--out") outputPath = args[++i];
    else if (!a.startsWith("-") && !fileId) fileId = a;
  }
  return { fileId, dryRun, debug, fixturePath, outputPath, help };
}

function emit(stream: NodeJS.WriteStream, text: string): void {
  stream.write(redact(text));
}

/**
 * Wrap a write stream so every chunk passes through redact() before reaching
 * the underlying file descriptor. This is the FIX-10 defense-in-depth path
 * for unhandled-rejection / uncaught-exception messages that bypass the
 * application-level emit() wrappers (e.g. Node's default error printer when
 * a top-level await throws before main() installs its catch handler).
 */
export function bindRedactedStderr(stream: NodeJS.WriteStream): () => void {
  const original = stream.write.bind(stream);
  // The Node WriteStream.write signature has multiple overloads; coerce via
  // unknown to satisfy the structural assignment without leaking `any`.
  const wrapped = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") {
      return (original as (c: string, ...r: unknown[]) => boolean)(redact(chunk), ...rest);
    }
    if (chunk instanceof Uint8Array) {
      const text = Buffer.from(chunk).toString("utf8");
      return (original as (c: string, ...r: unknown[]) => boolean)(redact(text), ...rest);
    }
    return (original as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof stream.write;
  stream.write = wrapped;
  return () => {
    stream.write = original as typeof stream.write;
  };
}

export async function main(argv: string[]): Promise<number> {
  const restoreStderr = bindRedactedStderr(process.stderr);
  try {
    const args = parseArgs(argv);
    if (args.help) {
      emit(process.stdout, HELP);
      return 0;
    }
    if (!args.fileId) {
      emit(process.stderr, "error: missing <file_id>\n");
      return 2;
    }
    if (!args.fixturePath) {
      emit(
        process.stderr,
        "error: live Figma execution is out of scope for this skeleton; pass --fixture <path>\n",
      );
      return 2;
    }
    if (args.dryRun) {
      const summary = await buildPipelineFromFixture(args.fixturePath, { fileId: args.fileId });
      for (const f of summary.frames) {
        emit(
          process.stdout,
          `frame ${f.screen_id} estimated_bytes=${f.estimatedBytes}\n`,
        );
      }
      emit(process.stdout, `TOTAL frames=${summary.frames.length}\n`);
      return 0;
    }
    const result = await runPipelineFromFixture(args.fixturePath, {
      fileId: args.fileId,
      debug: args.debug,
    });
    if (args.outputPath) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(args.outputPath, result.manifestJson, "utf8");
    } else {
      emit(process.stdout, result.manifestJson + "\n");
    }
    return 0;
  } finally {
    restoreStderr();
  }
}

// Only auto-run when invoked as a script (not when imported by tests).
const isDirectInvocation = (() => {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  try {
    const entry = process.argv[1];
    return entry.endsWith("cli.js") || entry.endsWith("cli.ts");
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`error: ${redact(String((err as Error).message ?? err))}\n`);
      process.exit(1);
    },
  );
}
