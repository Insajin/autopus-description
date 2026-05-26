// SPEC-FIGMA-015 INV-BRIEF-PATH — Path safety guard for project brief files.
// Confines all brief paths to `<workspaceRoot>/.autopus/runs/` so MCP callers
// cannot escape via `..` or absolute paths.

import { resolve } from "node:path";

const REQUIRED_FIELDS: readonly string[] = Object.freeze([
  "project_name",
  "product_summary",
  "primary_users",
  "business_goals",
  "core_user_flows",
  "global_policies",
]);

export const BRIEF_REQUIRED_FIELDS = REQUIRED_FIELDS;

/**
 * Confirm `path` resolves under `<workspaceRoot>/.autopus/runs/`. Rejects
 * parent-traversal (`..`), null bytes, and any resolved path that falls
 * outside the runs root. Returns `null` when safe; otherwise an error message
 * suitable for surfacing to MCP callers.
 */
export function assertBriefPath(
  path: string,
  workspaceRoot: string,
): string | null {
  if (!path) return "brief path empty";
  if (path.includes("\0")) return "brief path contains null byte";
  const resolved = resolve(workspaceRoot, path);
  const runsRoot = resolve(workspaceRoot, ".autopus", "runs");
  const isUnder =
    resolved === runsRoot ||
    resolved.startsWith(runsRoot + "/") ||
    resolved.startsWith(runsRoot + "\\");
  if (!isUnder) {
    return `brief path must be under ${runsRoot}`;
  }
  return null;
}

/**
 * Parse a brief JSON payload (may have leading commentary before the first
 * `{`) and return the prefix + parsed body. Used by validate/update flows so
 * leading question commentary is preserved on rewrite.
 */
export function parseBriefJson(raw: string): {
  prefix: string;
  parsed: Record<string, unknown>;
} {
  const jsonStart = raw.indexOf("{");
  const prefix = jsonStart >= 0 ? raw.slice(0, jsonStart) : "";
  const body = jsonStart >= 0 ? raw.slice(jsonStart) : raw;
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return { prefix, parsed };
}

export function findMissingRequired(
  parsed: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = parsed[f];
    if (
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    ) {
      missing.push(f);
    }
  }
  return missing;
}
