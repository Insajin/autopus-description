// SPEC-FIGMA-004 W4 — POST /api/apply route.
//
// Forwards a ManifestEntry to WriteRouter.apply. The router instance is
// process-scoped so undo state survives within a single Next.js process.
// Real Figma client wiring is out of scope here; the API surface is enough
// for the dashboard's "Apply" button to round-trip.

import { WriteRouter, type ManifestEntry } from "@autopus/write-router";

export const dynamic = "force-dynamic";

let router: WriteRouter | null = null;

function getRouter(): WriteRouter {
  if (!router) {
    router = new WriteRouter({
      auditLogPath: process.env.AUDIT_LOG_PATH,
      pmIdentity: process.env.PM_IDENTITY,
    });
  }
  return router;
}

const KNOWN_WRITE_TARGETS = new Set([
  "annotation_card",
  "descriptions_page",
  "comment",
  "plugin_data",
  "frame_name",
  "none",
]);

interface ApplyBody {
  entry?: ManifestEntry;
}

// Server-side entry shape validation (defense in depth — UI button gating
// can be bypassed by direct curl). Re-checks the minimum invariants the
// downstream WriteRouter and audit-log assume: required fields, write_target
// enum membership, and string types on identity-bearing fields.
function validateEntryShape(entry: unknown):
  | { ok: true; entry: ManifestEntry }
  | { ok: false; error: string; field: string } {
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: "entry must be an object", field: "entry" };
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.frame_id !== "string" || e.frame_id.length === 0) {
    return { ok: false, error: "frame_id required", field: "frame_id" };
  }
  if (typeof e.write_target !== "string" ||
      !KNOWN_WRITE_TARGETS.has(e.write_target)) {
    return {
      ok: false,
      error: `write_target must be one of ${[...KNOWN_WRITE_TARGETS].join(",")}`,
      field: "write_target",
    };
  }
  if (e.intent !== undefined && typeof e.intent !== "string") {
    return { ok: false, error: "intent must be a string", field: "intent" };
  }
  if (e.screen_id !== undefined && typeof e.screen_id !== "string") {
    return { ok: false, error: "screen_id must be a string", field: "screen_id" };
  }
  return { ok: true, entry: entry as ManifestEntry };
}

export async function POST(req: Request): Promise<Response> {
  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.entry) {
    return Response.json({ error: "entry required" }, { status: 400 });
  }
  const validated = validateEntryShape(body.entry);
  if (!validated.ok) {
    return Response.json(
      { error: "INVALID_ENTRY_SHAPE", field: validated.field, message: validated.error },
      { status: 400 },
    );
  }
  try {
    const result = await getRouter().apply(validated.entry);
    return Response.json(result, { status: 200 });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "WRITE_ERROR";
    const message = err instanceof Error ? err.message : String(err);
    const status = code === "MANIFEST_INVALID" ? 422 : 500;
    return Response.json({ error: code, message }, { status });
  }
}
