// SPEC-FIGMA-004 Phase 3 — POST /api/feedback route coverage.
// Asserts JSON Lines append behavior + token redaction via redactObject.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN_REGEX = /(figd_[A-Za-z0-9_-]{16,}|xoxb-[A-Za-z0-9_-]{8,})/g;

let tmpRoot: string;
let feedbackLogPath: string;
let POST: (req: Request) => Promise<Response>;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "api-feedback-"));
  feedbackLogPath = join(tmpRoot, "reader-feedback.jsonl");
  process.env.FEEDBACK_LOG_PATH = feedbackLogPath;
  vi.resetModules();
  ({ POST } = await import("../src/app/api/feedback/route.js"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.FEEDBACK_LOG_PATH;
});

describe("POST /api/feedback route handler", () => {
  it("returns 400 'invalid JSON body' when payload is not JSON", async () => {
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: "x",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid JSON body");
  });

  it("returns 400 'action required' when action field is missing", async () => {
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ comment: "ok" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("action required");
  });

  it("returns 400 when action is not a string", async () => {
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ action: 42 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("appends exactly one JSON line per submission with timestamp_iso prefix", async () => {
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        action: "thumbs_up",
        screen_id: "AUTH-01",
        comment: "states 필드 정확함",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("recorded");

    const lines = readFileSync(feedbackLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.action).toBe("thumbs_up");
    expect(parsed.screen_id).toBe("AUTH-01");
    expect(parsed.comment).toBe("states 필드 정확함");
    expect(parsed.timestamp_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts credential tokens leaked into free-text comment field", async () => {
    const FIGMA_TOKEN = "figd_LEAKEDTOKEN1234567890ABCD";
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        action: "comment",
        comment: `accidental: ${FIGMA_TOKEN}`,
      }),
    });
    await POST(req);
    const fileContent = readFileSync(feedbackLogPath, "utf8");
    expect(fileContent.match(TOKEN_REGEX) ?? []).toHaveLength(0);
    expect(fileContent).toContain("<REDACTED>");
  });

  it("appends sequentially when called twice (2 lines total)", async () => {
    const make = (n: number) =>
      new Request("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ action: "skip", screen_id: `S-${n}` }),
      });
    await POST(make(1));
    await POST(make(2));
    const lines = readFileSync(feedbackLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).screen_id).toBe("S-1");
    expect(JSON.parse(lines[1]).screen_id).toBe("S-2");
  });
});
