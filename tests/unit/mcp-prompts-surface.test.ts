// SPEC-MCP-001 — Phase 1.5 TDD RED scaffold.
// Acceptance oracle for the MCP "prompts" capability added to the autopus
// daemon. These tests reference modules that do NOT exist yet:
//   - src/daemon/figma-workflow-guidance.ts
//   - src/daemon/mcp-stdio-prompt-handlers.ts (wired via createMcpStdioServer)
// Until Phase 2 implements them, import resolution / assertions fail (RED).
//
// All assertions target observable behavior: instructions strings, prompt
// descriptors, prompt messages, and the frozen tools/resources surface.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import { createHttpSession } from "../../src/daemon/mcp-http-session-manager.js";
// [NEW] Phase 2 modules — these imports drive the RED state.
import { renderWorkflowInstructions } from "../../src/daemon/figma-workflow-guidance.js";

const PROMPT_NAME = "generate_frame_descriptions";

let auditDir: string;

beforeEach(() => {
  auditDir = mkdtempSync(join(tmpdir(), "mcp-prompts-"));
});

afterEach(() => {
  rmSync(auditDir, { recursive: true, force: true });
});

interface StdioOpts {
  readonly figmaChannel?: string;
  readonly descriptionLanguage?: () => string;
}

interface Harness {
  readonly client: Client;
  close(): Promise<void>;
}

async function makeStdioPair(opts: StdioOpts = {}): Promise<Harness> {
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({ auditDir, provider: "test" });
  const server = createMcpStdioServer({
    mcp,
    registry,
    auditWriter,
    figmaChannel: opts.figmaChannel,
    descriptionLanguage: opts.descriptionLanguage,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "claude-code", version: "0.0.1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

async function makeHttpPair(): Promise<Harness> {
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({ auditDir, provider: "test" });
  const session = createHttpSession({
    mcp,
    registry,
    auditWriter,
    auditLogPath: join(auditDir, "write-audit.jsonl"),
    clientName: "claude-code",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "claude-code", version: "0.0.1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await session.dispose();
    },
  };
}

function hex32(): string {
  return randomBytes(16).toString("hex");
}

describe("SPEC-MCP-001 — MCP prompts surface", () => {
  it("S1 stdio instructions embed ordered workflow + channel secret + language", async () => {
    const secret = hex32();
    const harness = await makeStdioPair({
      figmaChannel: secret,
      descriptionLanguage: () => "ko",
    });
    try {
      const instructions = harness.client.getInstructions();
      expect(instructions).toBeDefined();
      const text = instructions as string;
      expect(text).toContain("dryRun");
      expect(text).toContain("approve");
      expect(text).toContain("apply");
      expect(text).toContain("undo");
      expect(text.indexOf("dryRun")).toBeLessThan(text.indexOf("approve"));
      expect(text.indexOf("approve")).toBeLessThan(text.indexOf("apply"));
      const hasSelection =
        text.includes("get_active_selection") || text.includes("get_stale_frames");
      expect(hasSelection).toBe(true);
      // C-1 secret guidance preserved on stdio instructions.
      expect(text).toContain(secret);
      // Description-language guidance present on stdio instructions.
      const hasLang =
        text.includes("get_description_language") || text.includes("language");
      expect(hasLang).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("S2 http and stdio share the workflow block; http is not the old 9-tools one-liner", async () => {
    const stdio = await makeStdioPair();
    const http = await makeHttpPair();
    try {
      const stdioText = stdio.client.getInstructions() as string;
      const httpText = http.client.getInstructions() as string;
      expect(stdioText).toBeDefined();
      expect(httpText).toBeDefined();

      for (const part of ["dryRun", "approve", "apply", "undo"]) {
        expect(stdioText).toContain(part);
        expect(httpText).toContain(part);
      }

      // http instructions are no longer the old "9 tools" one-liner.
      expect(httpText).not.toContain("9 tools");
      expect(httpText).not.toBe(
        "Read+write HTTP MCP wire surface for the Autopus daemon (6 resources, 9 tools).",
      );

      // The shared workflow block (no-arg render) is a substring of both.
      const block = renderWorkflowInstructions();
      expect(stdioText).toContain(block);
      expect(httpText).toContain(block);

      // The common block must NOT name the stdio-only get_description_language tool.
      expect(block).not.toContain("get_description_language");
    } finally {
      await stdio.close();
      await http.close();
    }
  });

  it("S3 prompts capability is advertised and descriptor mentions dryRun/approve/apply", async () => {
    const harness = await makeStdioPair();
    try {
      expect(harness.client.getServerCapabilities()?.prompts).toBeDefined();
      const listed = await harness.client.listPrompts();
      const entry = listed.prompts.find((p) => p.name === PROMPT_NAME);
      expect(entry).toBeDefined();
      const desc = entry?.description ?? "";
      expect(desc).toContain("dryRun");
      expect(desc).toContain("approve");
      expect(desc).toContain("apply");
    } finally {
      await harness.close();
    }
  });

  it("S4 prompts/get returns an ordered user text message", async () => {
    const harness = await makeStdioPair();
    try {
      const got = await harness.client.getPrompt({ name: PROMPT_NAME });
      expect(got.messages.length).toBeGreaterThanOrEqual(1);
      const first = got.messages[0];
      expect(first.role).toBe("user");
      expect(first.content.type).toBe("text");
      const text = (first.content as { type: "text"; text: string }).text;
      expect(text).toContain("dryRun");
      expect(text).toContain("approve");
      expect(text).toContain("apply");
      expect(text).toContain("undo");
      expect(text.indexOf("dryRun")).toBeLessThan(text.indexOf("approve"));
      expect(text.indexOf("approve")).toBeLessThan(text.indexOf("apply"));
    } finally {
      await harness.close();
    }
  });

  it("S5 language line is read live per getPrompt call", async () => {
    let lang = "ko";
    const getter = () => lang;
    const harness = await makeStdioPair({ descriptionLanguage: getter });
    try {
      const first = await harness.client.getPrompt({ name: PROMPT_NAME });
      const firstText = (first.messages[0].content as { type: "text"; text: string }).text;
      expect(firstText).toContain("ko");

      lang = "en";
      const second = await harness.client.getPrompt({ name: PROMPT_NAME });
      const secondText = (second.messages[0].content as { type: "text"; text: string }).text;
      expect(secondText).toContain("en");
      expect(secondText).not.toBe(firstText);
    } finally {
      await harness.close();
    }
  });

  it("S6 channel secret never leaks into prompts payloads (but stays in instructions)", async () => {
    const secret = hex32();
    const harness = await makeStdioPair({ figmaChannel: secret });
    try {
      const listed = JSON.stringify(await harness.client.listPrompts());
      const got = JSON.stringify(
        await harness.client.getPrompt({ name: PROMPT_NAME }),
      );
      expect(listed).not.toContain(secret);
      expect(got).not.toContain(secret);
      // Contrast: C-1 secret guidance is preserved on stdio instructions only.
      expect(harness.client.getInstructions() as string).toContain(secret);
    } finally {
      await harness.close();
    }
  });

  it("S7 tools/resources baseline is unchanged and deterministic with prompts enabled", async () => {
    const a = await makeStdioPair();
    const b = await makeStdioPair();
    try {
      const toolsA = (await a.client.listTools()).tools;
      expect(toolsA.map((t) => t.name)).toEqual([
        "get_active_selection",
        "get_pending_descriptions",
        "get_audit_events",
        "get_stale_frames",
      ]);
      for (const tool of toolsA) {
        const schema = tool.inputSchema as {
          type: string;
          properties: Record<string, unknown>;
          additionalProperties?: boolean;
        };
        expect(schema.type).toBe("object");
        expect(Object.keys(schema.properties)).toHaveLength(0);
        expect(schema.additionalProperties).toBe(false);
      }

      const resA = (await a.client.listResources()).resources;
      const resB = (await b.client.listResources()).resources;
      expect(resA.length).toBeGreaterThan(0);
      expect(resA.map((r) => r.uri)).toEqual(resB.map((r) => r.uri));
      expect(resA.map((r) => r.name)).toEqual(resB.map((r) => r.name));
    } finally {
      await a.close();
      await b.close();
    }
  });
});
