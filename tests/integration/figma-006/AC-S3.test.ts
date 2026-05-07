// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S3.
// Read-pipeline + runBatch reuse — spies record callCount and lastArgs.

import { describe, it, expect, vi } from "vitest";
import * as readPipeline from "../../../src/read-pipeline.js";
import * as batchExecutor from "../../../src/batch-executor.js";

import { Daemon } from "../../../src/daemon/server.js";

describe("AC-S3: runReadPipeline + runBatch reuse", () => {
  it(
    "Given daemon with spies, When processNextSelection() returns, " +
      "Then runReadPipeline.callCount==1 AND runBatch.callCount==1 with frames[0].screen_id=='FRAME-01'",
    async () => {
      const readSpy = vi
        .spyOn(readPipeline, "runReadPipeline")
        .mockResolvedValue({
          manifest: {
            batch_id: "b",
            screen_id: "FRAME-01",
            entries: [{ frame_id: "1:1", screen_id: "FRAME-01" }],
          },
        } as never);
      const batchSpy = vi
        .spyOn(batchExecutor, "runBatch")
        .mockResolvedValue({
          frames: [{ display_id: "FRAME-01", description: "ok" }],
        } as never);

      const daemon = new Daemon({
        transport: "stdio",
        port: 0,
        fixturePath: "fixtures/30-frame-mock/frames.json",
        provider: "mock",
      });
      await daemon.boot();
      await daemon.onSelectionChange({
        figma_node_id: "1:1",
        screen_id: "FRAME-01",
        node_tree_summary: {},
        image_bytes_b64_sha256: "0".repeat(64),
        image_bytes_b64: "",
      });
      await daemon.processNextSelection();

      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(String(readSpy.mock.calls[0][0].fixturePath)).toMatch(
        /fixtures\/30-frame-mock\/frames\.json$/,
      );

      expect(batchSpy).toHaveBeenCalledTimes(1);
      const args = batchSpy.mock.calls[0][0] as {
        frames: Array<{ screen_id: string }>;
      };
      expect(args.frames).toHaveLength(1);
      expect(args.frames[0].screen_id).toBe("FRAME-01");

      await daemon.shutdown();
      vi.restoreAllMocks();
    },
  );
});
