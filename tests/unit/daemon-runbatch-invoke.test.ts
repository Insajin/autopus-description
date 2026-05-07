// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-04, AC-S3, AC-S6.
// Daemon invokes runBatch exactly once per accepted selection event with a
// single-frame batch whose frames[0].screen_id equals "FRAME-01".

import { describe, it, expect, vi } from "vitest";

import * as batchExecutor from "../../src/batch-executor.js";
import * as readPipeline from "../../src/read-pipeline.js";
import { Daemon } from "../../src/daemon/server.js";

describe("runBatch reuse (REQ-04, AC-S3)", () => {
  it("calls runBatch exactly once with frames.length===1 and screen_id 'FRAME-01'", async () => {
    vi.spyOn(readPipeline, "runReadPipeline").mockResolvedValue({
      manifest: { batch_id: "b", screen_id: "FRAME-01", entries: [{ frame_id: "1:1", screen_id: "FRAME-01" }] },
    } as never);
    const batchSpy = vi
      .spyOn(batchExecutor, "runBatch")
      .mockResolvedValue({ frames: [{ display_id: "FRAME-01", description: "ok" }] } as never);

    const daemon = new Daemon({ transport: "stdio", port: 0, provider: "mock" });
    await daemon.boot();
    await daemon.acceptSelection({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: {},
      image_bytes_b64_sha256: "0".repeat(64),
      image_bytes_b64: "",
    });
    await daemon.processNextSelection();

    expect(batchSpy).toHaveBeenCalledTimes(1);
    const args = batchSpy.mock.calls[0][0] as { frames: Array<{ screen_id: string }> };
    expect(args.frames).toHaveLength(1);
    expect(args.frames[0].screen_id).toBe("FRAME-01");

    await daemon.shutdown();
    vi.restoreAllMocks();
  });
});
