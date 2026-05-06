// SPEC-FIGMA-004 Phase 1.5 RED scaffold — AC-S7 Plugin Bridge fallback on MCP permission error.
// REQ-06, INV-006.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

import { WriteRouter } from "@autopus/write-router";
import { classifyMcpError } from "@autopus/write-router/fallback/error-classifier";
import * as pluginBridge from "@autopus/write-router/fallback/plugin-bridge";
import type { WriteResult } from "@autopus/write-router/types";

import { createMockFigmaWriteServer } from "../../fixtures/mock-figma-write-server.js";
import { createTmpAuditEnv, makeEntry } from "./_helpers.js";

let env: ReturnType<typeof createTmpAuditEnv>;

beforeEach(() => {
  env = createTmpAuditEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  env.cleanup();
});

describe("AC-S7: Plugin Bridge fallback on MCP permission error (REQ-06)", () => {
  it("classifies HTTP 403 with FORBIDDEN/seat_required as MCP_PERMISSION_ERROR", () => {
    const classified = classifyMcpError({
      status: 403,
      body: { error: "FORBIDDEN", reason: "seat_required" },
    });
    expect(classified).toBe("MCP_PERMISSION_ERROR");
  });

  it("falls back to plugin bridge exactly 1 time when MCP write returns 403, attempting MCP exactly 1 time first", async () => {
    const server = createMockFigmaWriteServer({
      mcpResponse: { status: 403, body: { error: "FORBIDDEN", reason: "seat_required" } },
    });
    const bridgeSpy = vi.spyOn(pluginBridge, "applyViaPluginBridge").mockResolvedValue({
      status: "applied",
      undo_descriptor: { type: "delete-node", node_id: "node-bridge-1" },
      write_id: "wb-1",
      fallback_used: true,
    } as WriteResult);

    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "annotation_card" });

    const result = await router.apply(entry);

    expect(server.calls.mcpAttempts).toHaveLength(1);
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
    expect(bridgeSpy.mock.calls[0][0]).toMatchObject({ screen_id: "AUTH-01" });
    expect(result.fallback_used).toBe(true);
  });

  it("audit log records FALLBACK_VIA_PLUGIN_BRIDGE and fallback_reason='MCP_PERMISSION_ERROR'", async () => {
    const server = createMockFigmaWriteServer({
      mcpResponse: { status: 403, body: { error: "FORBIDDEN", reason: "seat_required" } },
    });
    vi.spyOn(pluginBridge, "applyViaPluginBridge").mockResolvedValue({
      status: "applied",
      undo_descriptor: { type: "delete-node", node_id: "node-bridge-1" },
      write_id: "wb-1",
      fallback_used: true,
    } as WriteResult);

    const router = new WriteRouter({ figma: server, auditLogPath: env.auditLogPath });
    const entry = makeEntry({ write_target: "annotation_card" });

    await router.apply(entry);

    const lines = readFileSync(env.auditLogPath, "utf8").trim().split("\n");
    const last = lines[lines.length - 1];
    expect(last).toContain("FALLBACK_VIA_PLUGIN_BRIDGE");
    expect(JSON.parse(last).fallback_reason).toBe("MCP_PERMISSION_ERROR");
  });
});
