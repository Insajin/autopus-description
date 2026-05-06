// SPEC-FIGMA-004 manifest loader (REQ-12 / INV-010).
// Wraps SPEC-FIGMA-001 `validate-manifest` CLI as a child process and
// surfaces a structured {valid, data?, errors?} result for the UI / API route.
// Supports a stubValidator option for unit tests so vitest doesn't depend on
// the compiled CLI binary at tools/validate-manifest.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const ERR_INVALID_MANIFEST_PATH = "INVALID_MANIFEST_PATH";

export interface ValidationError {
  code: string;
  json_pointer: string;
  message: string;
}

export interface LoadResult<T = unknown> {
  valid: boolean;
  data?: T;
  errors?: ValidationError[];
  exitCode: number;
}

export interface StubValidator {
  exitCode: number;
  stderr?: string;
}

export interface LoadOptions {
  manifestPath: string;
  validatorBin?: string;
  manifestContent?: unknown;
  stubValidator?: StubValidator;
}

const DEFAULT_VALIDATOR =
  "tools/validate-manifest/dist/index.js";

// Resolve the manifest-root containment boundary. Defaults to process.cwd()
// so localhost dev usage stays scoped to the workspace; production callers
// can override via MANIFEST_ROOT to permit a curated directory.
function manifestRoot(): string {
  return path.resolve(process.env.MANIFEST_ROOT ?? process.cwd());
}

// Reject paths that escape the manifest root or contain traversal segments.
// Returns the canonical absolute path on success.
export function assertSafeManifestPath(
  candidate: string,
  rootOverride?: string,
): string {
  if (typeof candidate !== "string" || candidate.length === 0) {
    const err = new Error("manifestPath must be a non-empty string");
    (err as { code?: string }).code = ERR_INVALID_MANIFEST_PATH;
    throw err;
  }
  const root = rootOverride ? path.resolve(rootOverride) : manifestRoot();
  const resolved = path.resolve(root, candidate);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    const err = new Error(
      `manifestPath escapes manifest root (${root})`,
    );
    (err as { code?: string }).code = ERR_INVALID_MANIFEST_PATH;
    throw err;
  }
  return resolved;
}

function parseStderr(stderr: string): ValidationError[] {
  const out: ValidationError[] = [];
  for (const raw of stderr.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.code === "string" &&
        typeof parsed.json_pointer === "string"
      ) {
        out.push({
          code: parsed.code,
          json_pointer: parsed.json_pointer,
          message:
            typeof parsed.message === "string" ? parsed.message : "",
        });
      }
    } catch {
      // Non-JSON line (usage error, summary, etc.) — skip.
    }
  }
  return out;
}

function runValidator(
  validatorBin: string,
  manifestPath: string,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [validatorBin, manifestPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.stdout.on("data", () => {
      /* discard */
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stderr });
    });
  });
}

export async function loadManifest<T = unknown>(
  arg: string | LoadOptions,
): Promise<LoadResult<T>> {
  const options: LoadOptions =
    typeof arg === "string" ? { manifestPath: arg } : arg;

  // Path traversal guard. Skipped when stubValidator is supplied (test-only
  // fast path — production never sets stubValidator). Production callers
  // always exercise the guard against MANIFEST_ROOT.
  const safeManifestPath = options.stubValidator !== undefined
    ? options.manifestPath
    : assertSafeManifestPath(options.manifestPath);

  let exitCode: number;
  let stderr: string;

  if (options.stubValidator) {
    exitCode = options.stubValidator.exitCode;
    stderr = options.stubValidator.stderr ?? "";
  } else {
    const r = await runValidator(
      options.validatorBin ?? DEFAULT_VALIDATOR,
      safeManifestPath,
    );
    exitCode = r.exitCode;
    stderr = r.stderr;
  }

  if (exitCode === 0) {
    let data: T | undefined;
    if (options.manifestContent !== undefined) {
      data = options.manifestContent as T;
    } else {
      try {
        data = JSON.parse(await readFile(safeManifestPath, "utf8")) as T;
      } catch {
        data = undefined;
      }
    }
    return { valid: true, data, exitCode };
  }

  return {
    valid: false,
    errors: parseStderr(stderr),
    exitCode,
  };
}
