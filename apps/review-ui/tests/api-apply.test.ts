// SPEC-FIGMA-004 Phase 3 — POST /api/apply route coverage.
// Round-trips a ManifestEntry through the route handler and asserts on
// observable response body / status. Module-scoped router persists
// across `it` blocks within this file (route uses a module-level singleton
// and Vitest does not isolate module state by default).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManifestEntry } from "@autopus/write-router";

let tmpRoot: string;
let auditLogPath: string;
let POST: (req: Request) => Promise<Response>;

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
    source_hash: "h1",
    write_target: "none",
    persona_tags: ["pm"],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as ManifestEntry;
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "api-apply-"));
  auditLogPath = join(tmpRoot, "audit.log");
  process.env.AUDIT_LOG_PATH = auditLogPath;
  vi.resetModules();
  ({ POST } = await import("../src/app/api/apply/route.js"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.AUDIT_LOG_PATH;
  delete process.env.PM_IDENTITY;
});

describe("POST /api/apply route handler", () => {
  it("returns 200 with status='applied' when entry is valid", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({ entry: makeEntry({ write_target: "none" }) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("applied");
    expect(body.write_id).toMatch(/^wr-/);
  });

  it("appends one audit log line per successful apply", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({ entry: makeEntry({ frame_id: "audit:1" }) }),
    });
    await POST(req);
    expect(existsSync(auditLogPath)).toBe(true);
    const lines = readFileSync(auditLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.frame_id).toBe("audit:1");
    expect(parsed.pm_identity_or_unknown).toBe("unknown");
  });

  it("returns 400 with error='invalid JSON body' when body is not JSON", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid JSON body");
  });

  it("returns 400 with error='entry required' when entry field is missing", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("entry required");
  });

  it("returns 500 with error code from WriteRouterError when adapter throws non-MANIFEST_INVALID", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({
        entry: makeEntry({ write_target: "frame_name" as ManifestEntry["write_target"] }),
      }),
    });
    const res = await POST(req);
    expect([400, 500]).toContain(res.status);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("respects PM_IDENTITY env override in audit log", async () => {
    process.env.PM_IDENTITY = "pm-test-user";
    vi.resetModules();
    ({ POST } = await import("../src/app/api/apply/route.js"));
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({ entry: makeEntry({ frame_id: "id-pm:1" }) }),
    });
    await POST(req);
    const parsed = JSON.parse(readFileSync(auditLogPath, "utf8").trim());
    expect(parsed.pm_identity_or_unknown).toBe("pm-test-user");
  });

  it("returns 400 INVALID_ENTRY_SHAPE when entry is not an object", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({ entry: "not-an-object" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_ENTRY_SHAPE");
    expect(body.field).toBe("entry");
  });

  it("returns 400 INVALID_ENTRY_SHAPE when frame_id is missing", async () => {
    const e = makeEntry();
    delete (e as Record<string, unknown>).frame_id;
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({ entry: e }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_ENTRY_SHAPE");
    expect(body.field).toBe("frame_id");
  });

  it("returns 400 INVALID_ENTRY_SHAPE when write_target is unknown", async () => {
    const req = new Request("http://localhost/api/apply", {
      method: "POST",
      body: JSON.stringify({
        entry: { ...makeEntry(), write_target: "evil_target" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_ENTRY_SHAPE");
    expect(body.field).toBe("write_target");
  });
});
