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

const DEFAULT_VALIDATOR = "node tools/validate-manifest/dist/cli.js";

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
    frames: [entry],
  };
  writeFileSync(file, JSON.stringify(envelope), "utf-8");
  const cmd = opts.validatorBinary ?? DEFAULT_VALIDATOR;
  const [bin, ...rest] = cmd.split(/\s+/);
  const argv = [...rest, file];
  const proc = spawnSync(bin, argv, { encoding: "utf-8" });
  if (proc.status === 0) {
    return { ok: true, errors: [] };
  }
  // Validator prints AJV errors as JSON on stdout when ajv check fails.
  let parsed: AjvResult["errors"] = [];
  try {
    const stdout = (proc.stdout ?? "").trim();
    if (stdout) {
      const obj = JSON.parse(stdout) as {
        errors?: AjvResult["errors"];
      };
      parsed = obj.errors ?? [];
    }
  } catch {
    parsed = [
      {
        instancePath: "",
        message: (proc.stderr ?? "").trim() || "validator exited non-zero",
      },
    ];
  }
  if (parsed.length === 0) {
    parsed = [
      {
        instancePath: "",
        message: (proc.stderr ?? "").trim() || "validator exited non-zero",
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
