// SPEC-MCP-001 Phase 3 — edge-case coverage for the two new modules.
// Closes the branches the S1-S7 acceptance oracle leaves uncovered:
//   1. mcp-stdio-prompt-handlers.ts line 50 — GetPrompt unknown-name rejection
//      (McpError InvalidParams) is never exercised by S1-S7.
//   2. figma-workflow-guidance.ts line 54 — renderWorkflowInstructions
//      with-language branch (S2 only calls the no-arg form).
// These tests assert observable behavior (client-side rejection, rendered
// language text), never error absence alone. They do NOT touch S1-S7.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { McpResources } from "../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../src/daemon/mcp-stdio-entry.js";
import { renderWorkflowInstructions } from "../../src/daemon/figma-workflow-guidance.js";

let auditDir: string;

beforeEach(() => {
  auditDir = mkdtempSync(join(tmpdir(), "mcp-prompts-edge-"));
});

afterEach(() => {
  rmSync(auditDir, { recursive: true, force: true });
});

interface Harness {
  readonly client: Client;
  close(): Promise<void>;
}

// Mirror of makeStdioPair in mcp-prompts-surface.test.ts — kept local so the
// edge file is self-contained.
async function makeStdioPair(): Promise<Harness> {
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({ auditDir, provider: "test" });
  const server = createMcpStdioServer({ mcp, registry, auditWriter });
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

describe("SPEC-MCP-001 — edge cases", () => {
  it("getPrompt with an unknown name rejects", async () => {
    const harness = await makeStdioPair();
    try {
      // The server raises McpError(InvalidParams); the SDK surfaces it as a
      // client-side rejection. Covers prompt-handler line 50 (name guard).
      await expect(
        harness.client.getPrompt({ name: "does_not_exist" }),
      ).rejects.toThrow();
    } finally {
      await harness.close();
    }
  });

  it("renderWorkflowInstructions appends the live language line only when a getter is given", () => {
    // With-language branch (line 54 truthy path): the returned text literally
    // contains the getter's value.
    const withLang = renderWorkflowInstructions({ descriptionLanguage: () => "ja" });
    expect(withLang).toContain("ja");
    expect(withLang).toContain("Active description language: ja");

    // No-arg branch: the bare workflow block, with no language line.
    const noLang = renderWorkflowInstructions();
    expect(noLang).not.toContain("ja");
    expect(noLang).not.toContain("Active description language");
  });
});
