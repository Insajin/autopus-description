// SPEC-FIGMA-004 W4 — POST /api/undo route. Mirrors apply route.

import { WriteRouter } from "@autopus/write-router";

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

interface UndoBody {
  writeId?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: UndoBody;
  try {
    body = (await req.json()) as UndoBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.writeId) {
    return Response.json({ error: "writeId required" }, { status: 400 });
  }
  try {
    await getRouter().undo(body.writeId);
    return Response.json({ status: "undone", writeId: body.writeId });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "UNDO_ERROR";
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: code, message }, { status: 400 });
  }
}
