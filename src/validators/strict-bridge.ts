// SPEC-FIGMA-005 T9: bridge between strict-mode LLM responses and the
// existing AJV validator binary (tools/validate-manifest, SPEC-FIGMA-001).
// REQ-03, REQ-NFR-02. Defense-in-depth: even when Structured Outputs strict
// mode is engaged, the response payload MUST clear the AJV gate before it
// is persisted to the manifest. AJV violation surfaces as
// SCHEMA_AJV_VIOLATION with the failing instancePath.
//
// The validator is invoked via spawnSync (child-process boundary) so the
// AJV runtime stays out of the main process bundle and matches the
// SPEC-FIGMA-001 invocation contract.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ErrorCode,
  ProviderError,
  type ManifestEntry,
} from "../types/llm-provider.js";

export interface AjvResult {
  ok: boolean;
  errors: Array<{
    instancePath: string;
    message: string;
    schemaPath?: string;
  }>;
}

export interface StrictBridgeOptions {
  validatorBinary?: string;
}

export const DEFAULT_VALIDATOR_COMMAND =
  "node tools/validate-manifest/dist/index.js";

type ValidatorProcess = ReturnType<typeof spawnSync>;

function normalizeValidatorError(raw: unknown): AjvResult["errors"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    instancePath?: unknown;
    json_pointer?: unknown;
    message?: unknown;
    schemaPath?: unknown;
  };
  const instancePath =
    typeof row.instancePath === "string"
      ? row.instancePath
      : typeof row.json_pointer === "string"
        ? row.json_pointer
        : null;
  if (instancePath === null) return null;
  return {
    instancePath,
    message: typeof row.message === "string" ? row.message : "validator error",
    ...(typeof row.schemaPath === "string" ? { schemaPath: row.schemaPath } : {}),
  };
}

function parseLegacyStdout(stdout: string): AjvResult["errors"] {
  const text = stdout.trim();
  if (!text.startsWith("{")) return [];
  try {
    const obj = JSON.parse(text) as { errors?: unknown[] };
    return (obj.errors ?? [])
      .map(normalizeValidatorError)
      .filter((e): e is AjvResult["errors"][number] => e !== null);
  } catch {
    return [];
  }
}

function parseJsonlStderr(stderr: string): AjvResult["errors"] {
  const parsed: AjvResult["errors"] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const normalized = normalizeValidatorError(JSON.parse(text));
      if (normalized) parsed.push(normalized);
    } catch {
      continue;
    }
  }
  return parsed;
}

function outputText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") return value;
  if (value instanceof Buffer) return value.toString("utf8");
  return "";
}

function fallbackMessage(proc: ValidatorProcess): string {
  return (
    proc.error?.message ||
    outputText(proc.stderr).trim() ||
    outputText(proc.stdout).trim() ||
    "validator exited non-zero"
  );
}

/**
 * Run the AJV validator against a single ManifestEntry. The validator
 * binary expects a manifest envelope, so the entry is wrapped in a minimal
 * { schema_version, frames: [entry] } payload before invocation.
 *
 * Returns ok=true with empty errors[] on PASS. On FAIL, returns ok=false
 * with the instancePath/message list so the caller can throw
 * SCHEMA_AJV_VIOLATION carrying the json_pointer.
 */
export function runAjvValidate(
  entry: ManifestEntry,
  opts: StrictBridgeOptions = {},
): AjvResult {
  const dir = mkdtempSync(join(tmpdir(), "figma005-strict-"));
  const file = join(dir, "entry.json");
  const envelope = {
    schema_version: "0.2.0",
    pilot_metadata: {
      pm_reviewer_id: "strict-bridge",
      pilot_date: "1970-01-01",
      figma_file_ids: ["strict-bridge"],
      total_token_cost: 0,
    },
    frames: [entry],
  };
  writeFileSync(file, JSON.stringify(envelope), "utf-8");
  const cmd = opts.validatorBinary ?? DEFAULT_VALIDATOR_COMMAND;
  const [bin, ...rest] = cmd.split(/\s+/);
  const argv = [...rest, file];
  const proc = spawnSync(bin, argv, { encoding: "utf-8" });
  if (proc.status === 0) {
    return { ok: true, errors: [] };
  }
  // The current validate-manifest tool emits JSONL errors on stderr and a
  // RESULT summary on stdout. Keep legacy stdout JSON support for older stubs.
  let parsed = parseJsonlStderr(outputText(proc.stderr));
  if (parsed.length === 0) parsed = parseLegacyStdout(outputText(proc.stdout));
  if (parsed.length === 0) {
    parsed = [
      {
        instancePath: "",
        message: fallbackMessage(proc),
      },
    ];
  }
  return { ok: false, errors: parsed };
}

/**
 * Convenience wrapper: run AJV and throw SCHEMA_AJV_VIOLATION on failure.
 * Caller catches and routes to errors.jsonl / stderr emission.
 */
export function assertAjvValid(
  entry: ManifestEntry,
  opts: StrictBridgeOptions = {},
): void {
  const res = runAjvValidate(entry, opts);
  if (res.ok) return;
  const first = res.errors[0];
  throw new ProviderError(
    ErrorCode.SCHEMA_AJV_VIOLATION,
    first.message,
    entry.screen_id,
    {
      json_pointer: first.instancePath,
      all_errors: res.errors,
    },
  );
}
