/**
 * AC-S1, AC-S2 — source_hash canonical determinism + byte-flip detection
 *
 * Given a fixture frame whose node_tree_summary equals {"a":1,"b":2}
 *   And screenshot bytes equal ASCII "abc" (S1) or "abd" (S2)
 * When computeSourceHash({ node_tree_summary, image_bytes }) is invoked
 * Then S1 returns the exact lowercase hex 014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420
 *  And S2 returns the exact lowercase hex 4d37393bcfd9719d10c9fd512971443cb20f6eb74123ffa60b546b86758a7b11
 *  And intermediate image_bytes_sha256 and canonical_json values match the SPEC oracle
 *  And re-invocation on identical input is byte-equal across 3 calls
 *  And S1 hash != S2 hash
 *
 * Linked: REQ-05, REQ-NFR-01, INV-001
 */
import { describe, it, expect } from "vitest";
import { computeSourceHash, canonicalJson, sha256Hex } from "../src/source-hash.js";

const S1_HASH = "014ed33c550bcd29e8f89dda0c140a9bd46643cdc78bd422b9fb532af338b420";
const S2_HASH = "4d37393bcfd9719d10c9fd512971443cb20f6eb74123ffa60b546b86758a7b11";
const S1_IMAGE_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const S2_IMAGE_SHA = "a52d159f262b2c6ddb724a61840befc36eb30c88877a4030b65cbe86298449c9";
const S1_CANONICAL_JSON =
  '{"image_bytes_sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","node_tree_summary":{"a":1,"b":2}}';

describe("AC-S1: source_hash canonical determinism", () => {
  const nodeTreeSummary = { a: 1, b: 2 };
  const imageBytesS1 = Buffer.from("abc", "ascii");

  it("returns the exact SPEC oracle hash for the canonical fixture", () => {
    const hash = computeSourceHash({ node_tree_summary: nodeTreeSummary, image_bytes: imageBytesS1 });
    expect(hash).toBe(S1_HASH);
  });

  it("returns identical bytes across 3 consecutive invocations (zero tolerance)", () => {
    const h1 = computeSourceHash({ node_tree_summary: nodeTreeSummary, image_bytes: imageBytesS1 });
    const h2 = computeSourceHash({ node_tree_summary: nodeTreeSummary, image_bytes: imageBytesS1 });
    const h3 = computeSourceHash({ node_tree_summary: nodeTreeSummary, image_bytes: imageBytesS1 });
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h1).toBe(S1_HASH);
  });

  it("intermediate image_bytes_sha256 equals SPEC oracle", () => {
    const intermediate = sha256Hex(imageBytesS1);
    expect(intermediate).toBe(S1_IMAGE_SHA);
  });

  it("intermediate canonical JSON string matches SPEC oracle (sorted keys, no whitespace)", () => {
    const cj = canonicalJson({
      image_bytes_sha256: S1_IMAGE_SHA,
      node_tree_summary: nodeTreeSummary,
    });
    expect(cj).toBe(S1_CANONICAL_JSON);
  });
});

describe("AC-S2: source_hash byte-flip detection", () => {
  const nodeTreeSummary = { a: 1, b: 2 };
  const imageBytesS2 = Buffer.from("abd", "ascii");

  it("returns the exact SPEC oracle hash for the byte-flipped fixture", () => {
    const hash = computeSourceHash({ node_tree_summary: nodeTreeSummary, image_bytes: imageBytesS2 });
    expect(hash).toBe(S2_HASH);
  });

  it("S2 hash is NOT equal to S1 hash (exact byte inequality)", () => {
    const hashS2 = computeSourceHash({ node_tree_summary: nodeTreeSummary, image_bytes: imageBytesS2 });
    expect(hashS2).not.toBe(S1_HASH);
  });

  it("intermediate image_bytes_sha256 for flipped input equals SPEC oracle", () => {
    const intermediate = sha256Hex(imageBytesS2);
    expect(intermediate).toBe(S2_IMAGE_SHA);
  });
});
