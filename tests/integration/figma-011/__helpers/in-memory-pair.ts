// SPEC-FIGMA-011 in-process integration helper.
// Builds a paired Client/Server via InMemoryTransport for the AC-WR-1..10
// scenarios. Extends the SPEC-FIGMA-009 read-only harness with write surface
// injection (DaemonWriteExtension + WriteMcpResources + plugin bridge stub).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";

import { McpResources } from "../../../../src/daemon/mcp-resources.js";
import { CapabilityProfileRegistry } from "../../../../src/daemon/capability-profile-registry.js";
import { DaemonAuditWriter } from "../../../../src/daemon/audit-writer.js";
import { createMcpStdioServer } from "../../../../src/daemon/mcp-stdio-entry.js";
import { DaemonWriteExtension } from "../../../../src/daemon/daemon-write-extension.js";
import type { WriteExtensionWithApprovals } from "../../../../src/daemon/mcp-stdio-write-handlers.js";
import { MockPluginBridge } from "../../figma-007/__helpers/mock-plugin-bridge.js";

export interface PairedWriteHarness {
  readonly client: Client;
  readonly mcp: McpResources;
  readonly registry: CapabilityProfileRegistry;
  readonly auditWriter: DaemonAuditWriter;
  readonly writeExtension: WriteExtensionWithApprovals;
  readonly bridge: MockPluginBridge;
  readonly auditLogPath: string;
  readonly auditDir: string;
  attachBridge(): void;
  detachBridge(): void;
  close(): Promise<void>;
}

export interface PairedWriteHarnessOptions {
  readonly auditDir: string;
  readonly clientName?: string;
  readonly attachBridge?: boolean;
}

export async function createPairedWriteHarness(
  opts: PairedWriteHarnessOptions,
): Promise<PairedWriteHarness> {
  const mcp = new McpResources();
  const registry = new CapabilityProfileRegistry();
  const auditWriter = new DaemonAuditWriter({
    auditDir: opts.auditDir,
    provider: "test",
  });
  const writeExtension = new DaemonWriteExtension({
    pmIdentity: "unknown",
  }) as WriteExtensionWithApprovals;
  const bridge = new MockPluginBridge();
  const auditLogPath = join(opts.auditDir, "write-audit.jsonl");

  const server = createMcpStdioServer({
    mcp,
    registry,
    auditWriter,
    writeExtension,
    writeResources: writeExtension.resources,
    auditLogPath,
  } as unknown as Parameters<typeof createMcpStdioServer>[0]);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client(
    { name: opts.clientName ?? "claude-code", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);

  if (opts.attachBridge !== false) {
    writeExtension.attachPluginBridge(bridge);
  }

  return {
    client,
    mcp,
    registry,
    auditWriter,
    writeExtension,
    bridge,
    auditLogPath,
    auditDir: opts.auditDir,
    attachBridge() {
      writeExtension.attachPluginBridge(bridge);
    },
    detachBridge() {
      writeExtension.bridge = null;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
