// SPEC-FIGMA-009 T7 / AC-W4 / REQ-06 — Phase 1.5 RED scaffold (unit).
// Verifies that registerResourceHandlers wires the ReadResource handler to
// pass the stringified payload through `redact` so figd_* tokens never reach
// the wire. Concrete redaction oracle: input "leaked figd_<token> inside
// payload" -> output "leaked *** inside payload" (INV-W2).

import { describe, it, expect, beforeEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import {
  registerResourceHandlers,
  registerToolHandlers,
} from "../../src/daemon/mcp-stdio-handlers.js";

const FIGD_TOKEN = "figd_abcdefghijklmnop1234";
const FIGD_RE = /figd_[A-Za-z0-9_-]{16,}/;

type HandlerMap = Map<string, (req: unknown) => Promise<unknown>>;

function makeServer(mcp: McpResources): Server {
  const server = new Server(
    { name: "autopus-mcp-stdio", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  registerResourceHandlers(server, { mcp });
  registerToolHandlers(server);
  return server;
}

async function invoke(
  server: Server,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handlers = (server as unknown as { _requestHandlers: HandlerMap })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`no handler for method ${method}`);
  return handler({ method, params });
}

describe("mcp-stdio outbound redaction — figd_* tokens (AC-W4 unit)", () => {
  let mcp: McpResources;
  let server: Server;

  beforeEach(async () => {
    mcp = new McpResources();
    server = makeServer(mcp);
  });

  it("ReadResource on active_selection redacts figd_* in description to '***'", async () => {
    await mcp.publish({
      frame_id: "FRAME-X",
      screen_id: "SCREEN-X",
      source_hash: "h2",
      generated_at: "2026-05-07T00:00:00Z",
      description: `leaked ${FIGD_TOKEN} inside payload`,
    });

    const resp = (await invoke(server, "resources/read", {
      uri: "autopus://active_selection",
    })) as { contents: Array<{ uri: string; mimeType: string; text: string }> };

    expect(resp.contents).toHaveLength(1);
    expect(resp.contents[0].uri).toBe("autopus://active_selection");
    expect(resp.contents[0].mimeType).toBe("application/json");
    // No figd_* match anywhere in payload.
    expect(FIGD_RE.test(resp.contents[0].text)).toBe(false);
    // Exactly one *** match (the redaction sentinel).
    const stars = resp.contents[0].text.match(/\*\*\*/g) ?? [];
    expect(stars).toHaveLength(1);
    // Concrete decoded value oracle.
    const parsed = JSON.parse(resp.contents[0].text) as { description: string };
    expect(parsed.description).toBe("leaked *** inside payload");
  });

  it("CallTool with figd_* in arguments redacts the token in returned content[0].text", async () => {
    const resp = (await invoke(server, "tools/call", {
      name: "get_active_selection",
      arguments: { payload: `another figd_zzzzzzzzzzzzzzzz9999` },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe("text");
    expect(FIGD_RE.test(resp.content[0].text)).toBe(false);
    expect(resp.isError === undefined || resp.isError === false).toBe(true);
  });

  it("ListResources returns 4 canonical URIs in order (sanity wiring)", async () => {
    const resp = (await invoke(server, "resources/list", {})) as {
      resources: Array<{ uri: string; name: string }>;
    };
    expect(resp.resources.map((r) => r.uri)).toEqual([
      "autopus://active_selection",
      "autopus://pending_descriptions",
      "autopus://audit_events",
      "autopus://stale_frames",
    ]);
  });

  it("ListTools returns 4 read-only tools (sanity wiring)", async () => {
    const resp = (await invoke(server, "tools/list", {})) as {
      tools: Array<{ name: string }>;
    };
    expect(resp.tools.map((t) => t.name)).toEqual([
      "get_active_selection",
      "get_pending_descriptions",
      "get_audit_events",
      "get_stale_frames",
    ]);
  });
});
