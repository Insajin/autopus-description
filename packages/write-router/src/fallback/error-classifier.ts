// SPEC-FIGMA-004 — MCP error classifier (REQ-06, INV-006).
// Maps an unknown error from the MCP write surface to one of four classes
// the WriteRouter uses to decide whether to invoke the Plugin Bridge fallback.

export type McpErrorClass =
  | "MCP_PERMISSION_ERROR"
  | "MCP_RATE_LIMIT"
  | "MCP_NETWORK"
  | "MCP_OTHER";

interface MaybeHttp {
  status?: number;
  statusCode?: number;
  body?: unknown;
  message?: string;
  code?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function asHttp(err: unknown): MaybeHttp {
  if (err && typeof err === "object") return err as MaybeHttp;
  return {};
}

function readStatus(err: MaybeHttp): number | undefined {
  if (typeof err.status === "number") return err.status;
  if (typeof err.statusCode === "number") return err.statusCode;
  return undefined;
}

function bodyMentions(err: MaybeHttp, needles: string[]): boolean {
  const body = err.body;
  if (!body) return false;
  if (typeof body === "string") {
    return needles.some((n) => body.includes(n));
  }
  if (typeof body === "object") {
    const txt = JSON.stringify(body);
    return needles.some((n) => txt.includes(n));
  }
  return false;
}

function isPermissionError(err: MaybeHttp): boolean {
  const status = readStatus(err);
  if (status === 401 || status === 403) return true;
  if (err.code === "FORBIDDEN" || err.code === "SEAT_REQUIRED") return true;
  if (
    typeof err.message === "string" &&
    /seat[_-]?required|forbidden|permission/i.test(err.message)
  ) {
    return true;
  }
  if (bodyMentions(err, ["FORBIDDEN", "SEAT_REQUIRED", "seat_required"])) {
    return true;
  }
  return false;
}

function isRateLimit(err: MaybeHttp): boolean {
  const status = readStatus(err);
  if (status === 429) return true;
  if (err.code === "RATE_LIMITED") return true;
  if (err.headers && err.headers["retry-after"] !== undefined) return true;
  return false;
}

function isNetwork(err: MaybeHttp): boolean {
  if (
    err.code === "ECONNREFUSED" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ENETUNREACH" ||
    err.code === "EAI_AGAIN"
  ) {
    return true;
  }
  return false;
}

export function classifyMcpError(err: unknown): McpErrorClass {
  const http = asHttp(err);
  if (isPermissionError(http)) return "MCP_PERMISSION_ERROR";
  if (isRateLimit(http)) return "MCP_RATE_LIMIT";
  if (isNetwork(http)) return "MCP_NETWORK";
  return "MCP_OTHER";
}

export function shouldFallbackToPluginBridge(err: unknown): boolean {
  return classifyMcpError(err) === "MCP_PERMISSION_ERROR";
}
