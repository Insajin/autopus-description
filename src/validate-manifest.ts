import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildMergedManifest, DEFAULT_GENERATION_STUB, type PartialManifest } from "./manifest-writer.js";

/**
 * SPEC-FIGMA-002 AC-S9 substitutability helper.
 *
 * Builds a merged manifest from a partial manifest (this SPEC) + a default
 * generation stub (SPEC-FIGMA-003 placeholder), writes it to a temp file, and
 * shells out to tools/validate-manifest (FIGMA-001 산출물). Returns the exit code.
 */

export async function validateManifestExitCode(partial: PartialManifest | unknown): Promise<number> {
  const merged = buildMergedManifest(partial as PartialManifest, DEFAULT_GENERATION_STUB);
  const dir = await mkdtemp(join(tmpdir(), "validate-manifest-"));
  const path = join(dir, "merged.manifest.json");
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
  const tool = resolve(process.cwd(), "tools/validate-manifest/dist/index.js");
  const proc = spawnSync(process.execPath, [tool, path], { encoding: "utf8" });
  return proc.status ?? 1;
}
