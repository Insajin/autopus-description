// SPEC-FIGMA-004 W4 — POST /api/feedback route (REQ-22, AC-S22).
//
// Appends one JSON line per submission to `./reader-feedback.jsonl` (override
// via FEEDBACK_LOG_PATH). Skip / escalate / star-rating / free-text comments
// all flow through here. Token redaction is applied before write so accidental
// inclusion of credentials in free-text doesn't reach disk.

import { appendFile } from "node:fs/promises";
import { redactObject } from "@autopus/write-router/redactor";

export const dynamic = "force-dynamic";

interface FeedbackBody {
  action?: string;
  screen_id?: string;
  frame_id?: string;
  rating?: number;
  comment?: string;
  [extra: string]: unknown;
}

function resolveLogPath(): string {
  return process.env.FEEDBACK_LOG_PATH ?? "./reader-feedback.jsonl";
}

export async function POST(req: Request): Promise<Response> {
  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.action || typeof body.action !== "string") {
    return Response.json({ error: "action required" }, { status: 400 });
  }
  const record = {
    timestamp_iso: new Date().toISOString(),
    ...body,
  };
  const safe = redactObject(record);
  await appendFile(resolveLogPath(), JSON.stringify(safe) + "\n", {
    encoding: "utf8",
  });
  return Response.json({ status: "recorded" });
}
