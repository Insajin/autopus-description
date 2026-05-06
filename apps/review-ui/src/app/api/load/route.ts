import { loadManifest } from "../../../lib/manifest-loader.js";

export const dynamic = "force-dynamic";

interface LoadRequestBody {
  manifestPath?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: LoadRequestBody;
  try {
    body = (await req.json()) as LoadRequestBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid JSON body" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  if (!body.manifestPath) {
    return new Response(
      JSON.stringify({ error: "manifestPath required" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const result = await loadManifest(body.manifestPath);
  return new Response(JSON.stringify(result), {
    status: result.valid ? 200 : 422,
    headers: { "content-type": "application/json" },
  });
}
