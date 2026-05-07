// SPEC-FIGMA-009 in-process integration helper.
// Builds a paired Client/Server via InMemoryTransport for AC-W1/W2/W3/W4
// scenarios. Avoids spawning external Codex/Claude binaries (NFR-04).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { McpResources } from "../../../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../../../src/daemon/mcp-stdio-entry.js";

export interface PairedHarness {
  readonly client: Client;
  readonly mcp: McpResources;
  readonly registry: CapabilityProfileRegistry;
  readonly auditWriter: DaemonAuditWriter;
  close(): Promise<void>;
}

export interface PairedHarnessOptions {
  readonly auditDir: string;
  readonly clientName?: string;
}

export async function createPairedHarness(
  opts: PairedHarnessOptions,
): Promise<PairedHarness> {
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({
    auditDir: opts.auditDir,
    provider: "test",
  });

  const server = createMcpStdioServer({ mcp, registry, auditWriter });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client(
    { name: opts.clientName ?? "claude-code", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);

  return {
    client,
    mcp,
    registry,
    auditWriter,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
