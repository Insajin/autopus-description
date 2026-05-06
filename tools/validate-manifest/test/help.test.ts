import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const CLI_ENTRY = resolve(PKG_ROOT, "src/index.ts");

test("AC-S22: --help prints usage line and exits 0", () => {
  const r = spawnSync("npx", ["tsx", CLI_ENTRY, "--help"], { cwd: PKG_ROOT, encoding: "utf-8" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("Usage: validate-manifest <path>"), `stdout missing usage line:\n${r.stdout}`);
});

test("AC-S22: missing argument exits 2 with stderr", () => {
  const r = spawnSync("npx", ["tsx", CLI_ENTRY], { cwd: PKG_ROOT, encoding: "utf-8" });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes("error: missing argument <path>"), `stderr missing error line:\n${r.stderr}`);
});
