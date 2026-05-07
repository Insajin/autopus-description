// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S1.
// Selection event accepted with deterministic source_hash recompute.
// Linked: REQ-02, NFR-02, INV-001, INV-005.

import { describe, it, expect } from "vitest";
import { computeSourceHash } from "../../../src/source-hash.js";

import { Daemon } from "../../../src/daemon/server.js";

describe("AC-S1: Selection event accepted with deterministic source_hash", () => {
  it(
    "Given daemon running, When plugin emits selection_change for 1:1, " +
      "Then queue.size === 1 AND queue.peek().source_hash equals 014ed33c…b420",
    async () => {
      const daemon = new Daemon({ transport: "stdio", port: 0 });
      await daemon.boot();

      await daemon.onSelectionChange({
        figma_node_id: "1:1",
        screen_id: "FRAME-01",
        node_tree_summary: { a: 1, b: 2 },
        image_bytes_b64_sha256:
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        image_bytes_b64: "YWJj",
      });

      expect(daemon.queue.size).toBe(1);
      const peek = daemon.queue.peek();
      expect(peek).toBeDefined();
      expect(peek!.frame_id).toBe("1:1");
      expect(peek!.source_hash).toBe(
        "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
      );

      // Byte-equal check via the frozen computeSourceHash function
      const expected = computeSourceHash({
        node_tree_summary: { a: 1, b: 2 },
        image_bytes: Buffer.from("abc", "ascii"),
      } as never);
      expect(peek!.source_hash).toBe(expected);

      await daemon.shutdown();
    },
  );

  it("no audit row contains a figd_ prefix in provider_sdk_version", async () => {
    const daemon = new Daemon({ transport: "stdio", port: 0 });
    await daemon.boot();
    await daemon.onSelectionChange({
      figma_node_id: "1:1",
      screen_id: "FRAME-01",
      node_tree_summary: { a: 1, b: 2 },
      image_bytes_b64_sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      image_bytes_b64: "YWJj",
    });
    await daemon.processNextSelection();
    const audits = daemon.getEmittedAudits();
    for (const a of audits) {
      expect(a.provider_sdk_version).not.toMatch(/^figd_/);
    }
    await daemon.shutdown();
  });
});
