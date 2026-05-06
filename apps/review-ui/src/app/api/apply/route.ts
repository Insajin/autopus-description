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

interface ApplyBody {
  entry?: ManifestEntry;
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
  try {
    const result = await getRouter().apply(body.entry);
    return Response.json(result, { status: 200 });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "WRITE_ERROR";
    const message = err instanceof Error ? err.message : String(err);
    const status = code === "MANIFEST_INVALID" ? 422 : 500;
    return Response.json({ error: code, message }, { status });
  }
}
