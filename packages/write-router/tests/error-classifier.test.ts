import { describe, it, expect } from "vitest";
import {
  classifyMcpError,
  shouldFallbackToPluginBridge,
} from "../src/fallback/error-classifier.js";

describe("classifyMcpError (REQ-06 / INV-006)", () => {
  it("returns MCP_PERMISSION_ERROR for HTTP 403", () => {
    expect(classifyMcpError({ status: 403 })).toBe("MCP_PERMISSION_ERROR");
  });

  it("returns MCP_PERMISSION_ERROR for HTTP 401", () => {
    expect(classifyMcpError({ status: 401 })).toBe("MCP_PERMISSION_ERROR");
  });

  it("returns MCP_PERMISSION_ERROR when err.code === 'FORBIDDEN'", () => {
    expect(classifyMcpError({ code: "FORBIDDEN" })).toBe(
      "MCP_PERMISSION_ERROR",
    );
  });

  it("returns MCP_PERMISSION_ERROR when err.code === 'SEAT_REQUIRED'", () => {
    expect(classifyMcpError({ code: "SEAT_REQUIRED" })).toBe(
      "MCP_PERMISSION_ERROR",
    );
  });

  it("returns MCP_PERMISSION_ERROR when body contains seat_required", () => {
    expect(
      classifyMcpError({ status: 403, body: { error: "FORBIDDEN", reason: "seat_required" } }),
    ).toBe("MCP_PERMISSION_ERROR");
  });

  it("returns MCP_RATE_LIMIT for HTTP 429", () => {
    expect(classifyMcpError({ status: 429 })).toBe("MCP_RATE_LIMIT");
  });

  it("returns MCP_RATE_LIMIT when retry-after header is present", () => {
    expect(
      classifyMcpError({ status: 503, headers: { "retry-after": "10" } }),
    ).toBe("MCP_RATE_LIMIT");
  });

  it("returns MCP_NETWORK on ECONNREFUSED", () => {
    expect(classifyMcpError({ code: "ECONNREFUSED" })).toBe("MCP_NETWORK");
  });

  it("returns MCP_NETWORK on ETIMEDOUT", () => {
    expect(classifyMcpError({ code: "ETIMEDOUT" })).toBe("MCP_NETWORK");
  });

  it("returns MCP_OTHER for unrecognized errors", () => {
    expect(classifyMcpError({ status: 500 })).toBe("MCP_OTHER");
    expect(classifyMcpError(new Error("boom"))).toBe("MCP_OTHER");
    expect(classifyMcpError(null)).toBe("MCP_OTHER");
    expect(classifyMcpError(undefined)).toBe("MCP_OTHER");
  });

  it("uses statusCode field as a fallback for status", () => {
    expect(classifyMcpError({ statusCode: 403 })).toBe("MCP_PERMISSION_ERROR");
  });

  it("matches permission keywords in err.message", () => {
    expect(classifyMcpError({ message: "seat_required" })).toBe(
      "MCP_PERMISSION_ERROR",
    );
    expect(classifyMcpError({ message: "permission denied" })).toBe(
      "MCP_PERMISSION_ERROR",
    );
  });
});

describe("shouldFallbackToPluginBridge", () => {
  it("returns true only for MCP_PERMISSION_ERROR", () => {
    expect(shouldFallbackToPluginBridge({ status: 403 })).toBe(true);
    expect(shouldFallbackToPluginBridge({ status: 429 })).toBe(false);
    expect(shouldFallbackToPluginBridge({ status: 500 })).toBe(false);
    expect(shouldFallbackToPluginBridge({ code: "ETIMEDOUT" })).toBe(false);
  });
});
