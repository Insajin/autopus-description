// SPEC-FIGMA-007 W3 unit test — plugin-side source_hash webcrypto port.
// Linked: REQ-04, NFR-02 (cross-environment byte-equivalence).
//
// Asserts the webcrypto port produces byte-equal output to the Node-side
// `computeSourceHash` for the 30-frame mock fixture (oracle).

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { computeSourceHash } from "../../src/source-hash.js";

const PLUGIN_PORT_SPECIFIER =
  "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_source_hash.js";

interface PluginPort {
  computeSourceHashWebCrypto: (input: {
    node_tree_summary: unknown;
    image_bytes: Uint8Array;
  }) => Promise<string>;
  canonicalJson?: (value: unknown) => string;
}

async function loadPort(): Promise<PluginPort | null> {
  const mod = await import(/* @vite-ignore */ PLUGIN_PORT_SPECIFIER).catch(
    () => null,
  );
  return mod as unknown as PluginPort | null;
}

interface FrameFixture {
  figma_node_id: string;
  node_tree_summary: Record<string, unknown>;
  image_path?: string;
}

function loadFrames(): FrameFixture[] {
  const fixturePath = resolve(
    process.cwd(),
    "fixtures/30-frame-mock/frames.json",
  );
  if (!existsSync(fixturePath)) return [];
  const parsed = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    frames?: FrameFixture[];
  };
  return parsed.frames ?? [];
}

describe("plugin source_hash webcrypto port — REQ-04 / NFR-02", () => {
  it("port module exports computeSourceHashWebCrypto", async () => {
    const port = await loadPort();
    if (!port) {
      throw new Error(
        "vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_source_hash.ts not implemented yet (W3 T4 pending)",
      );
    }
    expect(typeof port.computeSourceHashWebCrypto).toBe("function");
  });

  it("byte-equal to Node computeSourceHash for the canonical SPEC-FIGMA-002 input ('abc' image bytes)", async () => {
    const port = await loadPort();
    if (!port) throw new Error("plugin port not implemented (W3 T4 pending)");
    const input = {
      node_tree_summary: { a: 1, b: 2 },
      image_bytes: new TextEncoder().encode("abc"),
    };
    const portHash = await port.computeSourceHashWebCrypto(input);
    const nodeHash = computeSourceHash({
      node_tree_summary: { a: 1, b: 2 },
      image_bytes: Buffer.from("abc", "ascii"),
    });
    expect(portHash).toBe(nodeHash);
    // SPEC-FIGMA-002 AC-S1 frozen oracle.
    expect(portHash).toBe(
      "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420",
    );
  });

  it("byte-equal for the AC-S5 mutated input ({a:1, b:3} + 'abc')", async () => {
    const port = await loadPort();
    if (!port) throw new Error("plugin port not implemented (W3 T4 pending)");
    const portHash = await port.computeSourceHashWebCrypto({
      node_tree_summary: { a: 1, b: 3 },
      image_bytes: new TextEncoder().encode("abc"),
    });
    const nodeHash = computeSourceHash({
      node_tree_summary: { a: 1, b: 3 },
      image_bytes: Buffer.from("abc", "ascii"),
    });
    expect(portHash).toBe(nodeHash);
  });

  it("byte-equal for all 30 frames in fixtures/30-frame-mock/", async () => {
    const port = await loadPort();
    if (!port) throw new Error("plugin port not implemented (W3 T4 pending)");
    const frames = loadFrames();
    expect(frames.length).toBe(30);
    for (const frame of frames) {
      // Use a deterministic byte-buffer derived from the figma_node_id
      // (port byte-equivalence test does not require real PNG bytes — just
      // a stable byte buffer the Node and webcrypto sides hash identically).
      const stub = new TextEncoder().encode(frame.figma_node_id);
      const summary = frame.node_tree_summary as unknown as {
        readonly [k: string]: import("../../src/source-hash.js").CanonicalValue;
      };
      const portHash = await port.computeSourceHashWebCrypto({
        node_tree_summary: summary,
        image_bytes: stub,
      });
      const nodeHash = computeSourceHash({
        node_tree_summary: summary,
        image_bytes: Buffer.from(stub),
      });
      expect(portHash).toBe(nodeHash);
      expect(portHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("canonicalJson sort/whitespace/integer rendering matches Node canonical form", async () => {
    const port = await loadPort();
    if (!port) throw new Error("plugin port not implemented (W3 T4 pending)");
    if (typeof port.canonicalJson !== "function") {
      throw new Error(
        "plugin port must export canonicalJson for byte-equivalence proof",
      );
    }
    // {b:2, a:1} → '{"a":1,"b":2}' (no whitespace, sorted keys, integer rendering)
    expect(port.canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(port.canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});
