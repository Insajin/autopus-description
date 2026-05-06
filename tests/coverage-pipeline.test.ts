/**
 * Coverage gap — src/pipeline.ts (payload_oversize_2x with 1x success, payload_oversize_1x skip,
 * design_tokens_status non-200, debug stderr branch, buildPipelineFromFixture summary)
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipelineFromFixture, buildPipelineFromFixture } from "../src/pipeline.js";

async function setupFixture(
  framesProducer: (writeImage: (name: string, contents: string) => Promise<string>) => Promise<unknown[]>,
): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "fig-fix-"));
  const writeImage = async (name: string, contents: string): Promise<string> => {
    await writeFile(join(baseDir, name), Buffer.from(contents, "utf8"));
    return name;
  };
  const frames = await framesProducer(writeImage);
  const fixture = {
    file_id: "TEST",
    prototype: { entry: null, transitions: [] },
    frames,
  };
  const fixturePath = join(baseDir, "frames.json");
  await writeFile(fixturePath, JSON.stringify(fixture), "utf8");
  return fixturePath;
}

describe("pipeline — coverage of fallback / skip / null-tokens / debug branches", () => {
  it("payload_oversize_2x with available 1x falls back to 1x bytes", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:1",
        screen_id: "FRAME-A",
        title: "A",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("a-2x.png", "twoXLARGE"),
        image_path_1x: await write("a-1x.png", "oneX"),
        image_scale: 2,
        design_tokens: ["color/x"],
        variants: ["v1"],
        navigation: [],
        payload_oversize_2x: true,
        node_tree_summary: { a: 1 },
      },
    ]);
    const result = await runPipelineFromFixture(fixturePath, { fileId: "TEST" });
    expect(result.manifest.frames.length).toBe(1);
    expect(result.skipped).toEqual([]);
    const audit = result.auditJsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(audit[0].status).toBe("ok");
    expect(audit[0].bytes_transferred).toBe(Buffer.byteLength("oneX"));
  });

  it("payload_oversize_1x skips frame and emits payload_oversize audit", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:1",
        screen_id: "FRAME-X",
        title: "X",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("x-2x.png", "huge"),
        image_path_1x: await write("x-1x.png", "stilltoobig"),
        image_scale: 2,
        design_tokens: null,
        variants: null,
        navigation: [],
        payload_oversize_2x: true,
        payload_oversize_1x: true,
        node_tree_summary: { z: 9 },
      },
    ]);
    const result = await runPipelineFromFixture(fixturePath, { fileId: "TEST" });
    expect(result.manifest.frames.length).toBe(0);
    expect(result.skipped).toEqual(["FRAME-X"]);
    const audit = JSON.parse(result.auditJsonl.trim());
    expect(audit.status).toBe("payload_oversize");
    expect(audit.bytes_transferred).toBe(0);
  });

  it("design_tokens_status non-200 nullifies design_tokens and variants", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:2",
        screen_id: "FRAME-DT",
        title: "DT",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("dt.png", "abc"),
        image_scale: 1,
        design_tokens: ["color/primary"],
        variants: ["state=default"],
        navigation: [],
        design_tokens_status: 403,
        node_tree_summary: { a: 1, b: 2 },
      },
    ]);
    const result = await runPipelineFromFixture(fixturePath, { fileId: "TEST" });
    expect(result.manifest.frames[0].design_tokens).toBeNull();
    expect(result.manifest.frames[0].variants).toBeNull();
  });

  it("debug=true writes redacted stderr line for ok frame", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:3",
        screen_id: "FRAME-OK",
        title: "OK",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("ok.png", "abc"),
        image_scale: 1,
        design_tokens: null,
        variants: null,
        navigation: [],
        node_tree_summary: { a: 1 },
      },
    ]);
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      lines.push(String(s));
      return true;
    };
    try {
      await runPipelineFromFixture(fixturePath, { fileId: "TEST", debug: true });
    } finally {
      (process.stderr as unknown as { write: typeof orig }).write = orig;
    }
    expect(lines.join("")).toContain("ok FRAME-OK");
  });

  it("debug=true writes payload_oversize stderr line for skipped frame", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:4",
        screen_id: "FRAME-OS",
        title: "OS",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("os-2x.png", "big"),
        image_path_1x: await write("os-1x.png", "stillbig"),
        image_scale: 2,
        design_tokens: null,
        variants: null,
        navigation: [],
        payload_oversize_2x: true,
        payload_oversize_1x: true,
        node_tree_summary: { a: 1 },
      },
    ]);
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      lines.push(String(s));
      return true;
    };
    try {
      await runPipelineFromFixture(fixturePath, { fileId: "TEST", debug: true });
    } finally {
      (process.stderr as unknown as { write: typeof orig }).write = orig;
    }
    expect(lines.join("")).toContain("skip FRAME-OS payload_oversize");
  });

  it("respects custom pmReviewerId, pilotDate, and clock", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:5",
        screen_id: "FRAME-C",
        title: "C",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("c.png", "x"),
        image_scale: 1,
        design_tokens: null,
        variants: null,
        navigation: [],
        node_tree_summary: { a: 1 },
      },
    ]);
    const fixedDate = new Date("2026-01-15T00:00:00Z");
    const result = await runPipelineFromFixture(fixturePath, {
      fileId: "TEST",
      pmReviewerId: "pm-X",
      pilotDate: "2026-12-31",
      clock: () => fixedDate,
    });
    expect(result.manifest.pilot_metadata.pm_reviewer_id).toBe("pm-X");
    expect(result.manifest.pilot_metadata.pilot_date).toBe("2026-12-31");
  });

  it("formatDate is used when pilotDate omitted (covers default branch)", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:6",
        screen_id: "FRAME-D",
        title: "D",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("d.png", "y"),
        image_scale: 1,
        design_tokens: null,
        variants: null,
        navigation: [],
        node_tree_summary: { a: 1 },
      },
    ]);
    const result = await runPipelineFromFixture(fixturePath, {
      fileId: "TEST",
      clock: () => new Date("2026-07-04T00:00:00Z"),
    });
    expect(result.manifest.pilot_metadata.pilot_date).toBe("2026-07-04");
  });

  it("buildPipelineFromFixture returns frame summaries with byte counts", async () => {
    const fixturePath = await setupFixture(async (write) => [
      {
        figma_node_id: "1:7",
        screen_id: "FRAME-S",
        title: "S",
        page_name: "P",
        parent_section_name: null,
        image_path: await write("s.png", "twelve-bytes"),
        image_scale: 1,
        design_tokens: null,
        variants: null,
        navigation: [],
        node_tree_summary: { a: 1 },
      },
    ]);
    const summary = await buildPipelineFromFixture(fixturePath, { fileId: "TEST" });
    expect(summary.frames.length).toBe(1);
    expect(summary.frames[0].screen_id).toBe("FRAME-S");
    expect(summary.frames[0].estimatedBytes).toBe(Buffer.byteLength("twelve-bytes"));
  });
});
