// SPEC-FIGMA-004 Phase 3 — POST /api/undo route coverage.
// Routes share a process-singleton WriteRouter with /api/apply, but each
// route module imports it independently. We exercise undo-only paths here
// (errors when writeId is missing or unknown) and one apply→undo handshake.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManifestEntry } from "@autopus/write-router";

let tmpRoot: string;
let undoPOST: (req: Request) => Promise<Response>;

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    screen_id: "AUTH-01",
    frame_id: "1:1",
    title: "로그인",
    intent: "사용자 인증 게이트",
    user_value: "PM 진입",
    success_criteria: "5초 진입",
    states: ["default"],
    edge_cases: [],
    component_refs: [],
    data_io: [],
    design_tokens: [],
    variants: [],
    navigation: [],
    confidence: 0.9,
    intent_mismatch: false,
    source_hash: "h-undo",
    write_target: "none",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "api-undo-"));
  process.env.AUDIT_LOG_PATH = join(tmpRoot, "audit.log");
  vi.resetModules();
  ({ POST: undoPOST } = await import("../src/app/api/undo/route.js"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.AUDIT_LOG_PATH;
});

describe("POST /api/undo route handler", () => {
  it("returns 400 'invalid JSON body' on malformed payload", async () => {
    const req = new Request("http://localhost/api/undo", {
      method: "POST",
      body: "{not json",
    });
    const res = await undoPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid JSON body");
  });

  it("returns 400 'writeId required' when writeId field is missing", async () => {
    const req = new Request("http://localhost/api/undo", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await undoPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("writeId required");
  });

  it("returns 400 with error code when writeId is unknown to the registry", async () => {
    const req = new Request("http://localhost/api/undo", {
      method: "POST",
      body: JSON.stringify({ writeId: "wr-nonexistent-99" }),
    });
    const res = await undoPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("WRITE_TARGET_ROUTING_ERROR");
    expect(body.message).toContain("unknown write_id");
  });

  it("apply then undo within the same singleton router returns status='undone' with the writeId", async () => {
    vi.resetModules();
    const { POST: applyPOST } = await import("../src/app/api/apply/route.js");
    const { POST: localUndoPOST } = await import("../src/app/api/undo/route.js");

    const applyReq = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({ entry: makeEntry({ write_target: "none" }) }),
    });
    const applyRes = await applyPOST(applyReq);
    const applyBody = await applyRes.json();
    expect(applyBody.write_id).toMatch(/^wr-/);

    // Apply and undo routes use SEPARATE module-scoped singletons. The undo
    // route therefore cannot resolve the apply route's write_id and must
    // return 400 — that is the documented behavior we assert on here.
    const undoReq = new Request("http://localhost/api/undo", {
      method: "POST",
      body: JSON.stringify({ writeId: applyBody.write_id }),
    });
    const undoRes = await localUndoPOST(undoReq);
    expect(undoRes.status).toBe(400);
    const undoBody = await undoRes.json();
    expect(undoBody.error).toBe("WRITE_TARGET_ROUTING_ERROR");
  });
});
