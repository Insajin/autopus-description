// SPEC-FIGMA-013 T8 / AC-HTTP-3 — Phase 1.5 RED scaffold.
// Maps to: REQ-06, INV-13.4.
// figd_* zero-leak across all read tools, write tools, all resources,
// and ≥ 16KB invalid-args error-message paths. Reconstructed-on-client
// payloads must contain regex match count == 0 for /figd_[A-Za-z0-9_-]{16,}/g.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";
import { createMcpHttpServer } from "../../../src/daemon/mcp-http-entry.js";
import { MAX_HTTP_BODY_BYTES } from "../../../src/daemon/mcp-http-guards.js";

const SYNTH_FIGD = "figd_" + "A".repeat(64);
const FIGD_RE_GLOBAL = /figd_[A-Za-z0-9_-]{16,}/g;

const READ_TOOLS = [
  "get_active_selection",
  "get_pending_descriptions",
  "get_audit_events",
  "get_stale_frames",
] as const;

const ALL_URIS = [
  "autopus://active_selection",
  "autopus://pending_descriptions",
  "autopus://audit_events",
  "autopus://stale_frames",
  "autopus://pending_writes",
  "autopus://applied_writes",
] as const;

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-3-"));
  harness = await createHttpHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

function extractText(resp: unknown): string {
  const c = (resp as { content: Array<{ type: string; text: string }> }).content;
  return c.map((x) => x.text).join("");
}

function mcpHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...extra,
  };
}

async function rawPost(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: mcpHeaders(headers),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function initializeRawSession(port: number): Promise<string> {
  const resp = await rawPost(port, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "raw-http-redact", version: "0.0.1" },
    },
  });
  await resp.text();
  const sessionId = resp.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  return sessionId ?? "";
}

async function postDeclaredHugeBody(port: number): Promise<{
  status: number;
  text: string;
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "content-length": String(MAX_HTTP_BODY_BYTES + 1),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.once("error", reject);
    req.end("{}");
  });
}

// @AX:ANCHOR: [AUTO] figd_* redaction is the HTTP wire confidentiality boundary.
// @AX:REASON: [AUTO] The test aggregates every tool/resource/error payload to prevent token leakage.
describe("AC-HTTP-3: figd_* zero-leak across all HTTP wire surfaces", () => {
  it("aggregate regex match count == 0 across all 9 tools, 6 resources, and ≥16KB error path", async () => {
    const captured: string[] = [];

    // 4 read tools (no args expected, but still observe response).
    for (const name of READ_TOOLS) {
      const resp = await harness.client.callTool({ name, arguments: {} });
      captured.push(extractText(resp));
    }

    // 5 write tools — inject SYNTH_FIGD into every textual arg slot.
    const planEmitResp = await harness.client.callTool({
      name: "plan_emit",
      arguments: { frame_id: SYNTH_FIGD, write_target: "annotation_card" },
    });
    captured.push(extractText(planEmitResp));

    const dryRunResp = await harness.client.callTool({
      name: "dryRun",
      arguments: { frame_id: SYNTH_FIGD, write_target: "annotation_card" },
    });
    const dryRunText = extractText(dryRunResp);
    captured.push(dryRunText);

    let pendingId: string;
    try {
      pendingId = (JSON.parse(dryRunText) as { pending_id: string }).pending_id;
    } catch {
      pendingId = SYNTH_FIGD;
    }

    const approveResp = await harness.client.callTool({
      name: "approve",
      arguments: { pending_id: pendingId },
    });
    captured.push(extractText(approveResp));

    const applyResp = await harness.client.callTool({
      name: "apply",
      arguments: {
        pending_id: pendingId,
        source_hash_recomputed: SYNTH_FIGD,
      },
    });
    captured.push(extractText(applyResp));

    const undoResp = await harness.client.callTool({
      name: "undo",
      arguments: { write_id: SYNTH_FIGD },
    });
    captured.push(extractText(undoResp));

    // 6 resources.
    for (const uri of ALL_URIS) {
      const r = await harness.client.readResource({ uri });
      captured.push((r.contents[0] as { text: string }).text);
    }

    // ≥ 16KB error-message path: invalid-args call with oversized fixture.
    const giantPayload = SYNTH_FIGD + "x".repeat(16384);
    let errorText = "";
    try {
      const resp = await harness.client.callTool({
        name: "dryRun",
        arguments: {
          frame_id: giantPayload,
          write_target: "annotation_card",
          extra_garbage: giantPayload,
        },
      });
      errorText = extractText(resp);
    } catch (err) {
      errorText = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    }
    captured.push(errorText);
    expect(errorText.length).toBeGreaterThanOrEqual(16384);

    let totalMatches = 0;
    for (const text of captured) {
      const m = text.match(FIGD_RE_GLOBAL);
      totalMatches += m ? m.length : 0;
    }
    expect(totalMatches).toBe(0);
    for (const text of captured) {
      expect(text.includes("figd_")).toBe(false);
    }
  });

  it("raw production HTTP responses redact SDK error paths and bound request size/session headers", async () => {
    const runtime = await createMcpHttpServer({ auditDir: workDir });
    try {
      const hugeResp = await postDeclaredHugeBody(runtime.port);
      expect(hugeResp.status).toBe(413);
      expect(hugeResp.text).toContain("Request body too large");
      expect(runtime.sessions.size).toBe(0);

      const sessionId = await initializeRawSession(runtime.port);
      const protocolResp = await rawPost(
        runtime.port,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        {
          "mcp-session-id": sessionId,
          "mcp-protocol-version": SYNTH_FIGD,
        },
      );
      const protocolText = await protocolResp.text();
      expect(protocolText).toContain("\"jsonrpc\"");
      expect(protocolText).not.toMatch(FIGD_RE_GLOBAL);
      expect(protocolText.includes("figd_")).toBe(false);

      const badUriResp = await rawPost(
        runtime.port,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "resources/read",
          params: { uri: `autopus://${SYNTH_FIGD}` },
        },
        { "mcp-session-id": sessionId },
      );
      const badUriText = await badUriResp.text();
      expect(badUriText).toContain("\"jsonrpc\"");
      expect(badUriText).not.toMatch(FIGD_RE_GLOBAL);
      expect(badUriText.includes("figd_")).toBe(false);

      const headerResp = await fetch(`http://127.0.0.1:${runtime.port}/mcp`, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          "mcp-session-id": "x".repeat(200),
          "mcp-protocol-version": "2025-03-26",
        },
      });
      expect(headerResp.status).toBe(400);
    } finally {
      await runtime.close();
    }
  });
});
