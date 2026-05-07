// SPEC-FIGMA-006 Phase 1.5 RED scaffold — REQ-03, AC-S3.
// Daemon invokes runReadPipeline exactly once per accepted selection event.

import { describe, it, expect, vi } from "vitest";

import * as readPipeline from "../../src/read-pipeline.js";
import { Daemon } from "../../src/daemon/server.js";

describe("runReadPipeline reuse (REQ-03, AC-S3)", () => {
  it("calls runReadPipeline exactly once with the configured fixture path", async () => {
    const spy = vi.spyOn(readPipeline, "runReadPipeline").mockResolvedValue({
      manifest: { batch_id: "b", screen_id: "FRAME-01", entries: [] },
    } as never);

    const daemon = new Daemon({
      transport: "stdio",
      port: 0,
      fixturePath: "fixtures/30-frame-mock/frames.json",
    });
    await daemon.boot();
    await daemon.acceptSelection({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: {},
      image_bytes_b64_sha256: "0".repeat(64),
      image_bytes_b64: "",
    });
    await daemon.processNextSelection();

    expect(spy).toHaveBeenCalledTimes(1);
    const lastArgs = spy.mock.calls[0];
    expect(String(lastArgs[0].fixturePath)).toMatch(/fixtures\/30-frame-mock\/frames\.json$/);

    await daemon.shutdown();
    spy.mockRestore();
  });
});
