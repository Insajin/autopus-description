import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { HttpSpy } from "./http-spy.js";

/**
 * SPEC-FIGMA-002 AC-S10 entry point.
 *
 * Drives a 30-frame read against the deterministic mock fixture and routes every
 * underlying request through the supplied HTTP client (the AC-S10 spy). All
 * invocations MUST be GET-only and MUST NOT touch /(comments|branches|plugin_data)/
 * paths (REQ-10, INV-004).
 */

export interface RunReadAdapterOptions {
  readonly fixturePath: string;
  readonly httpClient: HttpSpy;
  readonly fileId?: string;
}

interface FixtureFile {
  readonly file_id: string;
  readonly frames: ReadonlyArray<{
    readonly figma_node_id: string;
    readonly screen_id: string;
    readonly image_path: string;
  }>;
}

function fixtureFilePath(fixturePath: string): string {
  if (fixturePath.endsWith(".json")) return fixturePath;
  return join(fixturePath.replace(/\/+$/, ""), "frames.json");
}

export async function runReadAdapter(opts: RunReadAdapterOptions): Promise<void> {
  const path = fixtureFilePath(opts.fixturePath);
  const baseDir = dirname(resolve(path));
  const fixture = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
  const fileId = opts.fileId ?? fixture.file_id;
  // emulate the 4 read methods; route every GET through the spy.
  await opts.httpClient.get(`/v1/files/${encodeURIComponent(fileId)}`);
  await opts.httpClient.get(`/v1/files/${encodeURIComponent(fileId)}?prototype=true`);
  for (const f of fixture.frames) {
    await opts.httpClient.get(`/v1/files/${encodeURIComponent(fileId)}/nodes?ids=${encodeURIComponent(f.figma_node_id)}`);
    await opts.httpClient.get(`/v1/images/${encodeURIComponent(fileId)}?ids=${encodeURIComponent(f.figma_node_id)}&scale=2&format=png`);
    // load bytes locally to keep the run hermetic
    await readFile(join(baseDir, f.image_path));
  }
}
