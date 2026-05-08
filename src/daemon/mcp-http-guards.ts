import type {
  IncomingMessage,
  OutgoingHttpHeader,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";

import { redact } from "../token-redactor.js";

// @AX:NOTE: [AUTO] 1 MiB is the unauthenticated HTTP MCP request-body cap.
export const MAX_HTTP_BODY_BYTES = 1_048_576;
const MAX_SESSION_ID_LENGTH = 64;
const REDACT_TAIL_CHARS = 128;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HttpGuardError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function getSessionId(req: IncomingMessage): string | undefined {
  const sessionId = headerValue(req.headers["mcp-session-id"]);
  if (sessionId === undefined) return undefined;
  if (
    sessionId.length > MAX_SESSION_ID_LENGTH ||
    !SESSION_ID_PATTERN.test(sessionId)
  ) {
    throw new HttpGuardError(400, -32000, "Invalid or missing session ID");
  }
  return sessionId;
}

export function assertJsonContentType(req: IncomingMessage): void {
  const contentType = headerValue(req.headers["content-type"]) ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpGuardError(415, -32000, "Content-Type must be application/json");
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(headerValue(req.headers["content-length"]));
  if (Number.isFinite(declared) && declared > MAX_HTTP_BODY_BYTES) {
    throw new HttpGuardError(413, -32000, "Request body too large");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_HTTP_BODY_BYTES) {
      throw new HttpGuardError(413, -32000, "Request body too large");
    }
    chunks.push(buf);
  }

  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw.length === 0 ? undefined : JSON.parse(raw);
  } catch {
    throw new HttpGuardError(400, -32700, "Parse error: Invalid JSON");
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(redact(JSON.stringify(payload)));
}

export function installRedactedResponseGuard(res: ServerResponse): void {
  // @AX:ANCHOR: [AUTO] transport-level redaction guard for SDK-owned HTTP/SSE bytes.
  // @AX:REASON: [AUTO] StreamableHTTPServerTransport can generate protocol errors outside local handlers.
  const writeHead = res.writeHead.bind(res) as typeof res.writeHead;
  const write = res.write.bind(res) as typeof res.write;
  const end = res.end.bind(res) as typeof res.end;
  let tail = "";
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    restored = true;
    res.writeHead = writeHead;
    res.write = write;
    res.end = end;
  };
  const removeLength = (): void => {
    if (!res.headersSent && res.hasHeader("content-length")) {
      res.removeHeader("content-length");
    }
  };
  const redactChunk = (chunk: unknown, final: boolean): string => {
    const text =
      chunk === undefined
        ? ""
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("utf8")
          : String(chunk);
    const safe = redact(tail + text);
    if (final || safe.length <= REDACT_TAIL_CHARS) {
      tail = final ? "" : safe;
      return final ? safe : "";
    }
    tail = safe.slice(-REDACT_TAIL_CHARS);
    return safe.slice(0, -REDACT_TAIL_CHARS);
  };
  const stripLengthHeader = (headers: unknown): void => {
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) return;
    const h = headers as OutgoingHttpHeaders;
    delete h["content-length"];
    delete h["Content-Length"];
  };

  res.writeHead = ((
    statusCode: number,
    reason?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ) => {
    removeLength();
    stripLengthHeader(reason);
    stripLengthHeader(headers);
    return typeof reason === "string"
      ? writeHead(statusCode, reason, headers)
      : writeHead(statusCode, reason);
  }) as typeof res.writeHead;
  res.write = ((
    chunk: unknown,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => {
    removeLength();
    const out = redactChunk(chunk, false);
    if (!out) {
      if (typeof encoding === "function") encoding();
      else cb?.();
      return true;
    }
    return typeof encoding === "function"
      ? write(out, "utf8", encoding)
      : write(out, "utf8", cb);
  }) as typeof res.write;
  res.end = ((
    chunk?: unknown,
    encoding?: BufferEncoding | (() => void),
    cb?: () => void,
  ) => {
    removeLength();
    const out = redactChunk(chunk, true);
    const done = typeof encoding === "function" ? encoding : cb;
    return end(out, "utf8", done);
  }) as typeof res.end;
  res.once("finish", restore);
  res.once("close", restore);
}
