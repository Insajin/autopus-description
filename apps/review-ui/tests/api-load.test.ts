// SPEC-FIGMA-004 Phase 3 — POST /api/load route coverage.
// Backed by lib/manifest-loader. Real validator invocation is shelled out;
// in this test we exercise the route with paths that fail at the I/O layer
// so the handler exit branches are observable.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { POST } from "../src/app/api/load/route.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "api-load-"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/load route handler", () => {
  it("returns 400 'invalid JSON body' on malformed payload", async () => {
    const req = new Request("http://localhost/api/load", {
      method: "POST",
      body: "{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid JSON body");
  });

  it("returns 400 'manifestPath required' when path is missing", async () => {
    const req = new Request("http://localhost/api/load", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("manifestPath required");
  });

  it("returns 422 with valid:false when manifest file does not exist", async () => {
    const missing = join(tmpRoot, "missing.json");
    const req = new Request("http://localhost/api/load", {
      method: "POST",
      body: JSON.stringify({ manifestPath: missing }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it("returns 422 with valid:false on malformed JSON manifest", async () => {
    const path = join(tmpRoot, "bad.json");
    writeFileSync(path, "{not json", "utf8");
    const req = new Request("http://localhost/api/load", {
      method: "POST",
      body: JSON.stringify({ manifestPath: path }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });
});
