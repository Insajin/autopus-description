/**
 * Coverage gap — src/adapters/figma-developer-mcp-adapter.ts
 *
 * Drives all four FigmaReadAdapter methods through a stubbed FigmaMcpClient.
 * Asserts return-value content (not just NoError).
 */
import { describe, it, expect } from "vitest";
import { FigmaDeveloperMcpAdapter, type FigmaMcpClient } from "../src/adapters/figma-developer-mcp-adapter.js";

function makeClient(table: Record<string, unknown>): FigmaMcpClient {
  return {
    callTool: async (name: string) => {
      if (!(name in table)) throw new Error(`unexpected tool: ${name}`);
      return table[name];
    },
  };
}

describe("FigmaDeveloperMcpAdapter — coverage", () => {
  it("listTopLevelFrames maps pages and frames into FrameRef[]", async () => {
    const client = makeClient({
      get_file: {
        pages: [
          { name: "Page1", topLevelFrames: [{ id: "1:1", name: "Home Screen" }, { id: "1:2", name: "About" }] },
          { name: "Page2", topLevelFrames: [{ id: "2:1", name: "Settings" }] },
        ],
      },
    });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "figd_TESTTOKEN1234567890" });
    const out = await adapter.listTopLevelFrames("FILE-X");
    expect(out.length).toBe(3);
    expect(out[0].figma_node_id).toBe("1:1");
    expect(out[0].title).toBe("Home Screen");
    expect(out[0].page_name).toBe("Page1");
    expect(out[2].page_name).toBe("Page2");
  });

  it("listTopLevelFrames falls back to FRAME-NN when name has no leading ASCII", async () => {
    const client = makeClient({
      get_file: { pages: [{ name: "P", topLevelFrames: [{ id: "1:1", name: "!!" }] }] },
    });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const out = await adapter.listTopLevelFrames("F");
    expect(out[0].screen_id).toBe("FRAME-01");
  });

  it("listTopLevelFrames handles empty pages defaults", async () => {
    const client = makeClient({ get_file: {} });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const out = await adapter.listTopLevelFrames("F");
    expect(out.length).toBe(0);
  });

  it("getFrameMeta maps node response with all optional fields populated", async () => {
    const client = makeClient({
      get_node_meta: {
        id: "1:1",
        name: "Home",
        pageName: "P1",
        parentSectionName: "Sec",
        outgoingEdges: [{ from: "1:1", to: "1:2", trigger: "ON_TAP" }],
        componentInstances: [{ id: "c1", componentKey: "k1" }],
        designTokens: ["color/primary"],
        variants: ["state=default"],
      },
    });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const meta = await adapter.getFrameMeta("F", "1:1");
    expect(meta.figma_node_id).toBe("1:1");
    expect(meta.frame_name).toBe("Home");
    expect(meta.page_name).toBe("P1");
    expect(meta.parent_section_name).toBe("Sec");
    expect(meta.outgoing_prototype_edges[0].trigger).toBe("ON_TAP");
    expect(meta.child_component_instances[0].componentKey).toBe("k1");
    expect(meta.design_tokens).toEqual(["color/primary"]);
    expect(meta.variants).toEqual(["state=default"]);
  });

  it("getFrameMeta defaults missing optional fields to empty/null", async () => {
    const client = makeClient({ get_node_meta: { id: "1:1", name: "x" } });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const meta = await adapter.getFrameMeta("F", "1:1");
    expect(meta.page_name).toBe("");
    expect(meta.parent_section_name).toBeNull();
    expect(meta.outgoing_prototype_edges).toEqual([]);
    expect(meta.child_component_instances).toEqual([]);
    expect(meta.design_tokens).toBeNull();
    expect(meta.variants).toBeNull();
  });

  it("exportFrameImage decodes bytesBase64 to a Uint8Array", async () => {
    const b64 = Buffer.from([0x1, 0x2, 0x3]).toString("base64");
    const client = makeClient({ export_image: { bytesBase64: b64 } });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const bytes = await adapter.exportFrameImage("F", "1:1", 2);
    expect(Array.from(bytes)).toEqual([0x1, 0x2, 0x3]);
  });

  it("exportFrameImage uses raw bytes when bytesBase64 absent", async () => {
    const raw = new Uint8Array([0xa, 0xb]);
    const client = makeClient({ export_image: { bytes: raw } });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const bytes = await adapter.exportFrameImage("F", "1:1", 1);
    expect(Array.from(bytes)).toEqual([0xa, 0xb]);
  });

  it("exportFrameImage throws when neither bytes nor bytesBase64 present", async () => {
    const client = makeClient({ export_image: {} });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    await expect(adapter.exportFrameImage("F", "1:1", 2)).rejects.toThrow(/missing bytes/);
  });

  it("getPrototypeGraph maps entry and transitions", async () => {
    const client = makeClient({
      get_prototype_graph: {
        entry: "1:1",
        transitions: [
          { from: "1:1", to: "1:2", trigger: "ON_TAP" },
          { from: "1:2", to: "1:3", trigger: "ON_DRAG" },
        ],
      },
    });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const g = await adapter.getPrototypeGraph("F");
    expect(g.entry).toBe("1:1");
    expect(g.transitions.length).toBe(2);
    expect(g.transitions[1].trigger).toBe("ON_DRAG");
  });

  it("getPrototypeGraph defaults entry to null and transitions to []", async () => {
    const client = makeClient({ get_prototype_graph: {} });
    const adapter = new FigmaDeveloperMcpAdapter({ client, token: "tok" });
    const g = await adapter.getPrototypeGraph("F");
    expect(g.entry).toBeNull();
    expect(g.transitions).toEqual([]);
  });
});
