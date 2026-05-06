/**
 * REQ-10 / INV-004 read-only boundary test for the figma-developer-mcp adapter.
 *
 * AC-S10 covers the use_figma adapter via http-spy (HTTP-method gate). The
 * figma-developer-mcp adapter has no HTTP surface — its boundary is the set of
 * tool names passed to `FigmaMcpClient.callTool`. This test asserts the
 * recorded set equals the read-only allow-list and excludes any write-capable
 * tool name (no comments, plugin_data, post, patch, delete, write).
 */
import { describe, it, expect } from "vitest";
import { FigmaDeveloperMcpAdapter, type FigmaMcpClient } from "../src/adapters/figma-developer-mcp-adapter.js";

const READ_ONLY_TOOLS = new Set([
  "get_file",
  "get_node_meta",
  "export_image",
  "get_prototype_graph",
]);

const FORBIDDEN_FRAGMENTS = [
  "post",
  "patch",
  "delete",
  "put",
  "comments",
  "plugin_data",
  "write",
  "create",
  "update",
];

function makeRecordingClient(): { client: FigmaMcpClient; calls: string[] } {
  const calls: string[] = [];
  const client: FigmaMcpClient = {
    callTool: async (name) => {
      calls.push(name);
      switch (name) {
        case "get_file":
          return { pages: [{ name: "P1", topLevelFrames: [{ id: "1:1", name: "Home" }] }] };
        case "get_node_meta":
          return { id: "1:1", name: "Home" };
        case "export_image":
          return { bytesBase64: Buffer.from([0x1, 0x2]).toString("base64") };
        case "get_prototype_graph":
          return { entry: null, transitions: [] };
        default:
          throw new Error(`unexpected tool: ${name}`);
      }
    },
  };
  return { client, calls };
}

describe("figma-developer-mcp adapter — REQ-10 tool-name boundary", () => {
  it("listTopLevelFrames invokes ONLY get_file", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.listTopLevelFrames("FILE-1");
    expect(calls).toEqual(["get_file"]);
  });

  it("getFrameMeta invokes ONLY get_node_meta", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.getFrameMeta("FILE-1", "1:1");
    expect(calls).toEqual(["get_node_meta"]);
  });

  it("exportFrameImage invokes ONLY export_image", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.exportFrameImage("FILE-1", "1:1", 2);
    expect(calls).toEqual(["export_image"]);
  });

  it("getPrototypeGraph invokes ONLY get_prototype_graph", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.getPrototypeGraph("FILE-1");
    expect(calls).toEqual(["get_prototype_graph"]);
  });

  it("complete adapter sequence calls ONLY the read-only tool set (set equality)", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.listTopLevelFrames("FILE-1");
    await adapter.getFrameMeta("FILE-1", "1:1");
    await adapter.exportFrameImage("FILE-1", "1:1", 2);
    await adapter.getPrototypeGraph("FILE-1");
    const distinctCalls = new Set(calls);
    expect(distinctCalls).toEqual(READ_ONLY_TOOLS);
    expect(calls.length).toBe(4);
  });

  it("every recorded tool name is in the read-only allow-list", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.listTopLevelFrames("FILE-1");
    await adapter.getFrameMeta("FILE-1", "1:1");
    await adapter.exportFrameImage("FILE-1", "1:1", 1);
    await adapter.getPrototypeGraph("FILE-1");
    for (const name of calls) {
      expect(READ_ONLY_TOOLS.has(name)).toBe(true);
    }
  });

  it("no recorded tool name contains write-capable fragments", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await adapter.listTopLevelFrames("FILE-1");
    await adapter.getFrameMeta("FILE-1", "1:1");
    await adapter.exportFrameImage("FILE-1", "1:1", 2);
    await adapter.getPrototypeGraph("FILE-1");
    for (const name of calls) {
      const lower = name.toLowerCase();
      for (const fragment of FORBIDDEN_FRAGMENTS) {
        expect(lower.includes(fragment)).toBe(false);
      }
    }
  });

  it("repeated full adapter sequences keep the call set stable (no drift)", async () => {
    const { client, calls } = makeRecordingClient();
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    for (let i = 0; i < 3; i++) {
      await adapter.listTopLevelFrames("FILE-1");
      await adapter.getFrameMeta("FILE-1", "1:1");
      await adapter.exportFrameImage("FILE-1", "1:1", 2);
      await adapter.getPrototypeGraph("FILE-1");
    }
    expect(new Set(calls)).toEqual(READ_ONLY_TOOLS);
    expect(calls.length).toBe(12);
  });
});
