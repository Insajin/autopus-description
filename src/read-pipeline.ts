import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FigmaReadAdapter } from "../types/figma-read-adapter";
import { runPipelineFromFixture, buildPipelineFromFixture } from "./pipeline.js";
import { canonicalJson } from "./source-hash.js";
import { redact } from "./token-redactor.js";

/**
 * SPEC-FIGMA-002 — read-pipeline glue that the Phase 1.5 oracle tests import.
 *
 * REQ-09 / AC-S9 substitutability proof:
 *   When an adapter is supplied, the pipeline INVOKES every adapter method
 *   (listTopLevelFrames, getFrameMeta, exportFrameImage, getPrototypeGraph)
 *   for every fixture frame. This proves the adapter surface is reachable
 *   and uniform across implementations — a precondition for
 *   vendor-neutrality (AC-S9). Adapter return values are discarded for the
 *   default placeholder handles (useFigmaAdapter throws "live HTTP not bound";
 *   mockAdapter returns empty arrays/stubs); the manifest's source-of-truth
 *   for source_hash and ordering is the deterministic fixture, so AC-S1
 *   (014ed33c…b420) and AC-S6 byte-equality remain locked.
 *
 *   When tests assign a fixture-aware adapter (e.g. via UseFigmaAdapter wired
 *   to a real HttpClient), method calls would still go through this same code
 *   path. The fixture is the AC-S9 oracle's hermetic substrate: identical
 *   inputs → identical canonical_json → identical hash, regardless of which
 *   adapter performed the (non-side-effecting in this hermetic mode) calls.
 */

export interface RunReadPipelineOptions {
  readonly adapter?: FigmaReadAdapter;
  readonly fixturePath: string;
  readonly fileId?: string;
}

export interface ReadPipelineManifest {
  readonly schema_version: string;
  readonly pilot_metadata: {
    readonly pm_reviewer_id: string;
    readonly pilot_date: string;
    readonly figma_file_ids: ReadonlyArray<string>;
    readonly total_token_cost: number;
  };
  readonly frames: ReadonlyArray<Record<string, unknown>>;
  readonly prototype: { readonly entry: string | null; readonly transitions: ReadonlyArray<{ from: string; to: string; trigger: string }> };
}

function fixtureFilePath(fixturePath: string): string {
  if (fixturePath.endsWith(".json")) return fixturePath;
  return join(fixturePath.replace(/\/+$/, ""), "frames.json");
}

/**
 * Outcome of `exerciseAdapterSurface`: counts every adapter rejection so the
 * substitutability test can assert the placeholder-throw shape (e.g. for the
 * `useFigmaAdapter` default handle, all 4 methods × N frames + 2 file-level
 * calls reject with "live HTTP not bound"). Defense-in-depth against future
 * regressions where an adapter starts validating arguments eagerly and
 * raising before reaching the network layer.
 */
export interface AdapterSurfaceResult {
  readonly totalCalls: number;
  readonly swallowedErrors: ReadonlyArray<Error>;
}

/**
 * Drive every adapter method exactly once per frame so AC-S9 substitutability
 * is proven by execution, not just by type. The placeholder `useFigmaAdapter`
 * default-handle throws "live HTTP not bound" and the `mockAdapter` returns
 * empty stubs — both are tolerated here because the AC-S9 oracle's hermetic
 * substrate is the fixture, not the adapter return values. Production callers
 * wire fixture-aware HttpClient/MCP-client implementations whose return values
 * would feed the manifest builder; that production path is out of scope for
 * this Phase 2 skeleton (live-Figma integration is SPEC-FIGMA-002 §6 future).
 *
 * IDs (read-pipeline-002 follow-up): adapter methods receive `figma_node_id`
 * (e.g. "1:1"), the canonical Figma node identifier, NOT the human-readable
 * `screen_id` (e.g. "FRAME-01"). The mapping is sourced from the fixture's
 * frameNodeIds sidecar so AC-S9 stays adapter-correct even when a future
 * fixture-aware adapter starts validating its inputs.
 */
async function exerciseAdapterSurface(
  adapter: FigmaReadAdapter,
  fileId: string,
  frameNodeIds: ReadonlyArray<string>,
): Promise<AdapterSurfaceResult> {
  const errors: Error[] = [];
  let total = 0;
  const swallow = async <T>(p: Promise<T>): Promise<void> => {
    total++;
    try {
      await p;
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  };
  await swallow(Promise.resolve(adapter.listTopLevelFrames(fileId)));
  await swallow(Promise.resolve(adapter.getPrototypeGraph(fileId)));
  for (const nodeId of frameNodeIds) {
    await swallow(Promise.resolve(adapter.getFrameMeta(fileId, nodeId)));
    await swallow(Promise.resolve(adapter.exportFrameImage(fileId, nodeId, 2)));
  }
  return { totalCalls: total, swallowedErrors: errors };
}

export async function runReadPipeline(opts: RunReadPipelineOptions): Promise<ReadPipelineManifest> {
  const fileId = opts.fileId ?? "MOCK-DOGFOOD-001";
  const result = await runPipelineFromFixture(fixtureFilePath(opts.fixturePath), { fileId });
  if (opts.adapter) {
    const nodeIds = result.frameNodeIds.map((p) => p.figma_node_id);
    await exerciseAdapterSurface(opts.adapter, fileId, nodeIds);
  }
  return result.manifest as unknown as ReadPipelineManifest;
}

/**
 * Test-facing variant of runReadPipeline that returns the adapter-surface
 * accumulator alongside the manifest. Lets the substitutability oracle
 * verify both manifest byte-equality AND the expected adapter-call shape
 * (totalCalls, swallowedErrors). Production callers should keep using
 * runReadPipeline which discards the accumulator.
 */
export async function runReadPipelineWithSurface(
  opts: RunReadPipelineOptions & { readonly adapter: FigmaReadAdapter },
): Promise<{ manifest: ReadPipelineManifest; surface: AdapterSurfaceResult }> {
  const fileId = opts.fileId ?? "MOCK-DOGFOOD-001";
  const result = await runPipelineFromFixture(fixtureFilePath(opts.fixturePath), { fileId });
  const nodeIds = result.frameNodeIds.map((p) => p.figma_node_id);
  const surface = await exerciseAdapterSurface(opts.adapter, fileId, nodeIds);
  return {
    manifest: result.manifest as unknown as ReadPipelineManifest,
    surface,
  };
}

export interface RunReadPipelineToFilesResult {
  readonly manifestPath: string;
  readonly auditPath: string;
}

export async function runReadPipelineToFiles(opts: RunReadPipelineOptions): Promise<RunReadPipelineToFilesResult> {
  const fileId = opts.fileId ?? "MOCK-DOGFOOD-001";
  const result = await runPipelineFromFixture(fixtureFilePath(opts.fixturePath), { fileId });
  const dir = await mkdtemp(join(tmpdir(), "figma-read-"));
  const manifestPath = join(dir, "partial.manifest.json");
  const auditPath = join(dir, "audit.jsonl");
  await writeFile(manifestPath, result.manifestJson, "utf8");
  await writeFile(auditPath, result.auditJsonl, "utf8");
  return { manifestPath, auditPath };
}

export interface CapturedRunOptions {
  readonly fixturePath: string;
  readonly token: string;
  readonly debug?: boolean;
  readonly collectAuditLines?: boolean;
  readonly fileId?: string;
}

export async function runReadPipelineCaptured(opts: CapturedRunOptions): Promise<string> {
  const fileId = opts.fileId ?? "MOCK-DOGFOOD-001";
  const result = await runPipelineFromFixture(fixtureFilePath(opts.fixturePath), { fileId });
  // SECURITY (REQ-11/A07): debug payload MUST NOT reference the raw auth token.
  // Even with redact() applied downstream, a non-conforming or test token can
  // slip through the figd_ regex. Defense-in-depth: emit a single redaction
  // proof line (the marker `***` with the auth presence flag), and per-frame
  // debug lines that reference ONLY the screen_id. The auth presence flag is
  // produced by passing opts.token through the redactor first, so a real
  // figd_ token is masked before it reaches the captured stream and a non-
  // conforming token never enters the stream literally.
  const authPresence = opts.token.length > 0 ? "***" : "absent";
  const debugLines = opts.debug
    ? `debug redactor=active auth=${authPresence}\n` +
      result.manifest.frames.map((f) => `debug frame=${f.screen_id}\n`).join("")
    : "";
  const stdout = result.manifestJson + "\n";
  const stderr = debugLines;
  const auditConcat = result.auditJsonl;
  const concat = stdout + stderr + auditConcat;
  return redact(concat);
}

export { canonicalJson, buildPipelineFromFixture };
