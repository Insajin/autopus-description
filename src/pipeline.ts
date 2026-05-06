import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { computeSourceHash, type CanonicalValue } from "./source-hash.js";
import { redact } from "./token-redactor.js";
import {
  serializePartial,
  type PartialFrameEntry,
  type PartialManifest,
  SCHEMA_VERSION,
} from "./manifest-writer.js";
import { AuditLogger, BufferSink, nowIso, type AuditStatus } from "./audit-logger.js";

/**
 * SPEC-FIGMA-002 — pipeline glue.
 *
 * Reads the deterministic 30-frame mock fixture, computes per-frame source_hash,
 * emits a partial manifest + audit log, and reports peak in-flight observed.
 *
 * REQ-21 (Should): scale-down fallback for oversize 2x; skip oversize-1x with
 *   audit code payload_oversize.
 * REQ-23 (Should): when design_tokens API is unavailable (status != 200), set
 *   design_tokens=null and variants=null for that frame; do NOT abort the run.
 * REQ-NFR-01: deterministic output across runs after stripping volatile fields.
 */

export const SCALE_2X_BUDGET_BYTES = 2 * 1024 * 1024;

export interface FixtureFrame {
  readonly figma_node_id: string;
  readonly screen_id: string;
  readonly title: string;
  readonly page_name: string;
  readonly parent_section_name: string | null;
  readonly image_path: string;
  readonly image_scale: 1 | 2;
  readonly design_tokens: ReadonlyArray<string> | null;
  readonly variants: ReadonlyArray<string> | null;
  readonly navigation: ReadonlyArray<string>;
  readonly payload_oversize_2x?: boolean;
  readonly payload_oversize_1x?: boolean;
  readonly design_tokens_status?: number;
  readonly node_tree_summary: CanonicalValue;
  readonly image_path_1x?: string;
}

export interface FixtureFile {
  readonly file_id: string;
  readonly prototype: { entry: string | null; transitions: ReadonlyArray<{ from: string; to: string; trigger: string }> };
  readonly frames: ReadonlyArray<FixtureFrame>;
}

export interface PipelineOptions {
  readonly fileId: string;
  readonly debug?: boolean;
  readonly pmReviewerId?: string;
  readonly pilotDate?: string;
  readonly clock?: () => Date;
}

export interface FrameSummary {
  readonly screen_id: string;
  readonly estimatedBytes: number;
}

export interface PipelineSummary {
  readonly frames: ReadonlyArray<FrameSummary>;
}

export interface FrameNodeIdPair {
  readonly screen_id: string;
  readonly figma_node_id: string;
}

export interface PipelineResult {
  readonly manifest: PartialManifest;
  readonly manifestJson: string;
  readonly auditJsonl: string;
  readonly skipped: ReadonlyArray<string>;
  /**
   * Sidecar mapping screen_id → figma_node_id from the source fixture so adapter
   * call sites can pass the correct Figma identifier (e.g. "1:1") instead of
   * the human-readable screen_id (e.g. "FRAME-01"). Not part of the manifest
   * schema; consumed only by exerciseAdapterSurface in read-pipeline.ts.
   */
  readonly frameNodeIds: ReadonlyArray<FrameNodeIdPair>;
}

async function loadFixture(fixturePath: string): Promise<{ fixture: FixtureFile; baseDir: string }> {
  const abs = resolve(fixturePath);
  const raw = await readFile(abs, "utf8");
  const fixture = JSON.parse(raw) as FixtureFile;
  return { fixture, baseDir: dirname(abs) };
}

async function readImage(baseDir: string, relPath: string): Promise<Uint8Array> {
  return readFile(join(baseDir, relPath));
}

export async function buildPipelineFromFixture(
  fixturePath: string,
  opts: PipelineOptions,
): Promise<PipelineSummary> {
  const { fixture, baseDir } = await loadFixture(fixturePath);
  const frames: FrameSummary[] = [];
  for (const f of fixture.frames) {
    const bytes = await readImage(baseDir, f.image_path);
    frames.push({ screen_id: f.screen_id, estimatedBytes: bytes.byteLength });
  }
  return { frames };
}

export async function runPipelineFromFixture(
  fixturePath: string,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const { fixture, baseDir } = await loadFixture(fixturePath);
  const sink = new BufferSink();
  const auditor = new AuditLogger(sink);
  const clock = opts.clock ?? (() => new Date());
  const frames: PartialFrameEntry[] = [];
  const skipped: string[] = [];
  for (const f of fixture.frames) {
    const started = nowIso(clock());
    let bytes = await readImage(baseDir, f.image_path);
    let status: AuditStatus = "ok";
    if (f.payload_oversize_2x) {
      const oneXPath = f.image_path_1x ?? f.image_path;
      const oneX = await readImage(baseDir, oneXPath);
      if (f.payload_oversize_1x) {
        status = "payload_oversize";
        skipped.push(f.screen_id);
      } else {
        bytes = oneX;
      }
    }
    if (status === "payload_oversize") {
      auditor.log({
        frame_id: f.figma_node_id,
        started_at: started,
        finished_at: nowIso(clock()),
        retries: 0,
        bytes_transferred: 0,
        status,
      });
      if (opts.debug) process.stderr.write(redact(`skip ${f.screen_id} payload_oversize\n`));
      continue;
    }
    const sourceHash = computeSourceHash({
      node_tree_summary: f.node_tree_summary,
      image_bytes: bytes,
    });
    const dtStatus = f.design_tokens_status ?? 200;
    const designTokens = dtStatus === 200 ? f.design_tokens ?? null : null;
    const variants = dtStatus === 200 ? f.variants ?? null : null;
    const finished = nowIso(clock());
    frames.push({
      screen_id: f.screen_id,
      display_id: f.screen_id,
      title: f.title,
      navigation: f.navigation,
      source_hash: sourceHash,
      design_tokens: designTokens,
      variants: variants,
      extraction_started_at: started,
      extraction_finished_at: finished,
    });
    auditor.log({
      frame_id: f.figma_node_id,
      started_at: started,
      finished_at: finished,
      retries: 0,
      bytes_transferred: bytes.byteLength,
      status: "ok",
    });
    if (opts.debug) process.stderr.write(redact(`ok ${f.screen_id} bytes=${bytes.byteLength}\n`));
  }
  const sortedFrames = [...frames].sort((a, b) => a.screen_id.localeCompare(b.screen_id));
  const manifest: PartialManifest = {
    schema_version: SCHEMA_VERSION,
    pilot_metadata: {
      pm_reviewer_id: opts.pmReviewerId ?? "pm-figma-read",
      pilot_date: opts.pilotDate ?? formatDate(clock()),
      figma_file_ids: [opts.fileId],
      total_token_cost: 0,
    },
    frames: sortedFrames,
    prototype: fixture.prototype,
  };
  const frameNodeIds: FrameNodeIdPair[] = fixture.frames.map((f) => ({
    screen_id: f.screen_id,
    figma_node_id: f.figma_node_id,
  }));
  return {
    manifest,
    manifestJson: serializePartial(manifest),
    auditJsonl: sink.toJsonl(),
    skipped,
    frameNodeIds,
  };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
