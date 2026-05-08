import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { DaemonAuditWriter } from "../../../../src/daemon/audit-writer.js";
import { CapabilityProfileRegistry } from "../../../../src/daemon/capability-profile-registry.js";
import { McpResources } from "../../../../src/daemon/mcp-resources.js";
import {
  createHttpSession,
  type HttpSessionContext,
} from "../../../../src/daemon/mcp-http-session-manager.js";
import { MockPluginBridge } from "../../figma-007/__helpers/mock-plugin-bridge.js";

type HttpServer = ReturnType<typeof createServer>;
const DEFAULT_CLIENT_NAME = "codex-windows-stdio";

interface SessionRecord {
  readonly transport: StreamableHTTPServerTransport;
  readonly context: HttpSessionContext;
}

export interface HttpHarness {
  readonly client: Client;
  readonly httpServer: HttpServer;
  readonly port: number;
  readonly auditLogPath: string;
  readonly clientProfileAuditPath: string;
  readonly bridge: MockPluginBridge;
  getSessionIds(): string[];
  detachBridge(): void;
  close(): Promise<void>;
}

export interface CreateHttpHarnessOptions {
  readonly auditDir: string;
  readonly clientName?: string;
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

function containsInitialize(body: unknown): boolean {
  return Array.isArray(body)
    ? body.some((message) => isInitializeRequest(message))
    : isInitializeRequest(body);
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function serverError(res: ServerResponse, message: string): void {
  if (res.headersSent) return;
  sendJson(res, 500, {
    jsonrpc: "2.0",
    error: { code: -32603, message },
    id: null,
  });
}

// @AX:NOTE: [AUTO] The 1s poll only waits for the post-initialize audit row used by AC-HTTP-4/5.
async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function listenLoopback(httpServer: HttpServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected loopback TCP server address");
  }
  return (addr as AddressInfo).port;
}

async function createClient(port: number, clientName: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );
  const client = new Client(
    { name: clientName, version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

// @AX:ANCHOR: [AUTO] Shared HTTP harness for all SPEC-FIGMA-013 wire tests.
// @AX:REASON: [AUTO] It mirrors production routing while injecting the mock bridge used by session tests.
export async function createHttpHarness(
  opts: CreateHttpHarnessOptions,
): Promise<HttpHarness> {
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({
    auditDir: opts.auditDir,
    provider: "test-http",
  });
  const auditLogPath = join(opts.auditDir, "write-audit.jsonl");
  const clientProfileAuditPath = join(opts.auditDir, "audit.jsonl");
  const bridge = new MockPluginBridge();
  const sessions = new Map<string, SessionRecord>();
  let bridgeAttached = true;

  const createSessionTransport = (clientName: string) => {
    let transport!: StreamableHTTPServerTransport;
    let context!: HttpSessionContext;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, context });
      },
    });
    context = createHttpSession({
      mcp,
      registry,
      auditWriter,
      auditLogPath,
      clientName,
    });
    if (bridgeAttached) {
      context.writeExtension.attachPluginBridge(bridge);
    }
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };
    return { transport, context };
  };

  const httpServer = createServer(async (req, res) => {
    try {
      if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/mcp") {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      const sessionId = headerValue(req.headers["mcp-session-id"]);
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const existing = sessionId ? sessions.get(sessionId) : undefined;
        if (existing) {
          await existing.transport.handleRequest(req, res, body);
          return;
        }
        if (!sessionId && containsInitialize(body)) {
          const next = createSessionTransport(opts.clientName ?? DEFAULT_CLIENT_NAME);
          await next.context.server.connect(next.transport);
          await next.transport.handleRequest(req, res, body);
          return;
        }
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      if ((req.method === "GET" || req.method === "DELETE") && sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          sendJson(res, 400, { error: "Invalid or missing session ID" });
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { allow: "GET, POST, DELETE" });
      res.end();
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : String(err));
    }
  });

  const port = await listenLoopback(httpServer);
  const client = await createClient(port, opts.clientName ?? DEFAULT_CLIENT_NAME);
  await waitForFile(clientProfileAuditPath);

  return {
    client,
    httpServer,
    port,
    auditLogPath,
    clientProfileAuditPath,
    bridge,
    getSessionIds() {
      return [...sessions.keys()];
    },
    detachBridge() {
      bridgeAttached = false;
      // @AX:NOTE: [AUTO] Direct bridge nulling simulates the plugin-disconnect path required by AC-HTTP-6.
      for (const { context } of sessions.values()) {
        context.writeExtension.bridge = null;
      }
    },
    async close() {
      await client.close().catch(() => undefined);
      const records = [...sessions.values()];
      for (const { context } of records) {
        await context.dispose();
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export async function createSecondClient(
  harness: HttpHarness,
  clientName: string,
): Promise<Client> {
  return createClient(harness.port, clientName);
}
