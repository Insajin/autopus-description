#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { DaemonAuditWriter } from "./audit-writer.js";
import { CapabilityProfileRegistry } from "./capability-profile-registry.js";
import {
  assertJsonContentType,
  getSessionId,
  HttpGuardError,
  installRedactedResponseGuard,
  readJsonBody,
  sendJson,
} from "./mcp-http-guards.js";
import { createHttpSession, type HttpSessionContext } from "./mcp-http-session-manager.js";
import { McpResources } from "./mcp-resources.js";

const DEFAULT_BIND = "127.0.0.1";
const REMOTE_BIND = "0.0.0.0";
const DEFAULT_PORT = 0;
const SHUTDOWN_TIMEOUT_MS = 1_900; // @AX:NOTE: [AUTO] Cleanup budget stays below the 2s force-exit cap.

type HttpServer = ReturnType<typeof createServer>;

export interface McpHttpArgs {
  readonly port: number;
  readonly bind?: string;
  readonly allowRemote: boolean;
}

export interface CreateMcpHttpServerOptions {
  readonly port?: number;
  readonly bind?: string;
  readonly allowRemote?: boolean;
  readonly auditDir?: string;
  readonly cwd?: string;
  readonly emitStartupAudit?: boolean;
}

interface SessionRecord {
  readonly transport: StreamableHTTPServerTransport;
  readonly context: HttpSessionContext;
}

export interface McpHttpRuntime {
  readonly httpServer: HttpServer;
  readonly port: number;
  readonly address: string;
  readonly auditWriter: DaemonAuditWriter;
  readonly sessions: ReadonlyMap<string, SessionRecord>;
  close(): Promise<void>;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid --port value: ${value}`);
  }
  return port;
}

export function parseMcpHttpArgs(argv: readonly string[]): McpHttpArgs {
  let port = DEFAULT_PORT;
  let bind: string | undefined;
  let allowRemote = false;
  for (const arg of argv) {
    if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
    } else if (arg.startsWith("--bind=")) {
      bind = arg.slice("--bind=".length);
    } else if (arg === "--allow-remote") {
      allowRemote = true;
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  return { port, bind, allowRemote };
}

function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

function resolveBindAddress(opts: {
  readonly bind?: string;
  readonly allowRemote?: boolean;
}): string {
  const allowRemote = opts.allowRemote === true;
  const address = opts.bind ?? (allowRemote ? REMOTE_BIND : DEFAULT_BIND);
  if (!allowRemote && !isLoopbackAddress(address)) {
    throw new Error("non-loopback --bind requires --allow-remote");
  }
  return address;
}

function containsInitialize(body: unknown): boolean {
  return Array.isArray(body)
    ? body.some((message) => isInitializeRequest(message))
    : isInitializeRequest(body);
}

function closeHttpServer(httpServer: HttpServer): Promise<void> {
  if (!httpServer.listening) return Promise.resolve();
  return new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createMcpHttpServer(
  opts: CreateMcpHttpServerOptions = {},
): Promise<McpHttpRuntime> {
  const cwd = opts.cwd ?? process.cwd();
  const auditDir = opts.auditDir ?? process.env.AUTOPUS_AUDIT_DIR ?? join(cwd, ".autopus");
  const auditLogPath = join(auditDir, "write-audit.jsonl");
  const address = resolveBindAddress(opts);
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({
    auditDir,
    provider: "autopus-mcp-http",
  });
  const sessions = new Map<string, SessionRecord>();

  const createSession = (clientName: string): SessionRecord => {
    let transport!: StreamableHTTPServerTransport;
    const context = createHttpSession({
      mcp,
      registry,
      auditWriter,
      auditLogPath,
      clientName,
    });
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, context });
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) sessions.delete(sessionId);
    };
    return { transport, context };
  };

  const httpServer = createServer(async (req, res) => {
    installRedactedResponseGuard(res);
    try {
      if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/mcp") {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      const sessionId = getSessionId(req);
      if (req.method === "POST") {
        assertJsonContentType(req);
        const body = await readJsonBody(req);
        const existing = sessionId ? sessions.get(sessionId) : undefined;
        if (existing) {
          await existing.transport.handleRequest(req, res, body);
          return;
        }
        if (!sessionId && containsInitialize(body)) {
          const next = createSession("unknown");
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
      if (!res.headersSent) {
        if (err instanceof HttpGuardError) {
          sendJson(res, err.status, {
            jsonrpc: "2.0",
            error: { code: err.code, message: err.message },
            id: null,
          });
          return;
        }
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port ?? DEFAULT_PORT, address, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const info = httpServer.address() as AddressInfo;
  if (opts.emitStartupAudit) {
    auditWriter.emitEvent({
      event: "http_runtime_started",
      transport: "http",
      address: info.address,
      port: info.port,
    });
  }

  return {
    httpServer,
    port: info.port,
    address: info.address,
    auditWriter,
    sessions,
    async close(): Promise<void> {
      const serverClosed = closeHttpServer(httpServer);
      const records = [...sessions.values()];
      await Promise.allSettled(records.map((record) => record.context.dispose()));
      await Promise.race([serverClosed, delay(SHUTDOWN_TIMEOUT_MS)]);
      httpServer.closeAllConnections?.();
    },
  };
}

export async function runMcpHttp(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseMcpHttpArgs(argv);
  const runtime = await createMcpHttpServer({
    port: args.port,
    bind: args.bind,
    allowRemote: args.allowRemote,
    emitStartupAudit: true,
  });
  process.stdout.write(
    JSON.stringify({
      event: "http_listening",
      port: runtime.port,
      address: runtime.address,
    }) + "\n",
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(0), 2_000); // @AX:NOTE: [AUTO] SIGTERM AC requires exit within 2s.
    forceExit.unref();
    void runtime.close().finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await new Promise<never>(() => undefined);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMcpHttp().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`autopus-mcp-http: ${message}\n`);
    process.exit(1);
  });
}
