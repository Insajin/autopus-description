/**
 * Coverage gap — src/adapters/use-figma-adapter.ts
 *
 * Drives UseFigmaAdapter through a stub HttpClient that records each request
 * and returns shaped responses. Asserts response mapping, error paths,
 * and screen_id derivation.
 */
import { describe, it, expect } from "vitest";
import {
  UseFigmaAdapter,
  RetryableHttpError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from "../src/adapters/use-figma-adapter.js";

function stub(handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>): HttpClient {
  return { request: async (req) => handler(req) };
}

describe("UseFigmaAdapter — coverage", () => {
  it("listTopLevelFrames extracts FRAME nodes across pages", async () => {
    const client = stub(() => ({
      status: 200,
      bodyJson: {
        document: {
          children: [
            {
              id: "p1",
              name: "Page1",
              type: "CANVAS",
              children: [
                { id: "1:1", name: "Home", type: "FRAME" },
                { id: "1:2", name: "Skip", type: "GROUP" },
              ],
            },
            {
              id: "p2",
              name: "Page2",
              type: "CANVAS",
              children: [{ id: "2:1", name: "Settings", type: "FRAME" }],
            },
          ],
        },
      },
    }));
    const adapter = new UseFigmaAdapter({ client, token: "tok" });
    const out = await adapter.listTopLevelFrames("F");
    expect(out.length).toBe(2);
    expect(out[0].figma_node_id).toBe("1:1");
    expect(out[0].page_name).toBe("Page1");
    expect(out[1].title).toBe("Settings");
  });

  it("listTopLevelFrames returns empty when document missing", async () => {
    const client = stub(() => ({ status: 200, bodyJson: {} }));
    const adapter = new UseFigmaAdapter({ client, token: "tok" });
    const out = await adapter.listTopLevelFrames("F");
    expect(out).toEqual([]);
  });

  it("listTopLevelFrames maps non-ASCII names to FRAME-NN fallback", async () => {
    const client = stub(() => ({
      status: 200,
      bodyJson: { document: { children: [{ id: "p", name: "P", type: "CANVAS", children: [{ id: "1:1", name: "##", type: "FRAME" }] }] } },
    }));
    const out = await new UseFigmaAdapter({ client, token: "tok" }).listTopLevelFrames("F");
    expect(out[0].screen_id).toBe("FRAME-01");
  });

  it("getFrameMeta extracts component instances and outgoing edges recursively", async () => {
    const client = stub(() => ({
      status: 200,
      bodyJson: {
        nodes: {
          "1:1": {
            page_name: "P1",
            parent_section_name: "Sec",
            design_tokens: ["color/primary"],
            variants: ["state=hover"],
            document: {
              id: "1:1",
              name: "Home",
              type: "FRAME",
              transitionNodeID: "1:2",
              transitionTriggerType: "ON_CLICK",
              children: [
                { id: "c1", name: "Btn", type: "INSTANCE", componentId: "key-A" },
                {
                  id: "g1",
                  name: "Group",
                  type: "GROUP",
                  children: [{ id: "c2", name: "Btn2", type: "INSTANCE", componentId: "key-B", transitionNodeID: "1:3", transitionTriggerType: "ON_HOVER" }],
                },
              ],
            },
          },
        },
      },
    }));
    const meta = await new UseFigmaAdapter({ client, token: "tok" }).getFrameMeta("F", "1:1");
    expect(meta.frame_name).toBe("Home");
    expect(meta.page_name).toBe("P1");
    expect(meta.parent_section_name).toBe("Sec");
    expect(meta.child_component_instances.length).toBe(2);
    expect(meta.child_component_instances[0].componentKey).toBe("key-A");
    expect(meta.outgoing_prototype_edges.length).toBe(2);
    expect(meta.outgoing_prototype_edges[0].trigger).toBe("ON_CLICK");
    expect(meta.outgoing_prototype_edges[1].trigger).toBe("ON_HOVER");
  });

  it("getFrameMeta defaults page_name and parent_section_name when missing", async () => {
    const client = stub(() => ({
      status: 200,
      bodyJson: { nodes: { "1:1": { document: { id: "1:1", name: "Home", type: "FRAME" } } } },
    }));
    const meta = await new UseFigmaAdapter({ client, token: "tok" }).getFrameMeta("F", "1:1");
    expect(meta.page_name).toBe("");
    expect(meta.parent_section_name).toBeNull();
    expect(meta.design_tokens).toBeNull();
    expect(meta.variants).toBeNull();
  });

  it("getFrameMeta throws when node not in response", async () => {
    const client = stub(() => ({ status: 200, bodyJson: { nodes: {} } }));
    await expect(new UseFigmaAdapter({ client, token: "tok" }).getFrameMeta("F", "1:1")).rejects.toThrow(
      /node 1:1 not in response/,
    );
  });

  it("exportFrameImage fetches images endpoint then downloads bytes", async () => {
    const calls: HttpRequest[] = [];
    const client = stub((req) => {
      calls.push(req);
      if (req.url.includes("/images/")) return { status: 200, bodyJson: { images: { "1:1": "https://cdn/x.png" } } };
      return { status: 200, bodyBytes: new Uint8Array([1, 2, 3]) };
    });
    const bytes = await new UseFigmaAdapter({ client, token: "tok" }).exportFrameImage("F", "1:1", 2);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls.length).toBe(2);
    expect(calls[1].url).toBe("https://cdn/x.png");
  });

  it("exportFrameImage throws when image url missing", async () => {
    const client = stub(() => ({ status: 200, bodyJson: { images: {} } }));
    await expect(new UseFigmaAdapter({ client, token: "tok" }).exportFrameImage("F", "1:1", 2)).rejects.toThrow(
      /image url for 1:1 missing/,
    );
  });

  it("exportFrameImage throws when bodyBytes missing on download", async () => {
    const client = stub((req) => {
      if (req.url.includes("/images/")) return { status: 200, bodyJson: { images: { "1:1": "u" } } };
      return { status: 200 };
    });
    await expect(new UseFigmaAdapter({ client, token: "tok" }).exportFrameImage("F", "1:1", 2)).rejects.toThrow(
      /image bytes for 1:1 missing/,
    );
  });

  it("getPrototypeGraph extracts edges across all pages", async () => {
    const client = stub(() => ({
      status: 200,
      bodyJson: {
        document: {
          prototypeStartNodeID: "1:1",
          children: [
            {
              id: "p",
              name: "P",
              type: "CANVAS",
              children: [{ id: "1:1", name: "Home", type: "FRAME", transitionNodeID: "1:2", transitionTriggerType: "ON_CLICK" }],
            },
          ],
        },
      },
    }));
    const g = await new UseFigmaAdapter({ client, token: "tok" }).getPrototypeGraph("F");
    expect(g.entry).toBe("1:1");
    expect(g.transitions.length).toBe(1);
    expect(g.transitions[0].from).toBe("1:1");
  });

  it("requireOk: 4xx non-429 throws plain Error", async () => {
    const client = stub(() => ({ status: 404 }));
    await expect(new UseFigmaAdapter({ client, token: "tok" }).listTopLevelFrames("F")).rejects.toThrow(
      /figma http 404/,
    );
  });

  it("requireOk: 429 throws RetryableHttpError with status", async () => {
    const client = stub(() => ({ status: 429 }));
    await expect(
      new UseFigmaAdapter({ client, token: "tok" }).listTopLevelFrames("F"),
    ).rejects.toBeInstanceOf(RetryableHttpError);
  });

  it("requireOk: 5xx throws RetryableHttpError", async () => {
    const client = stub(() => ({ status: 503 }));
    try {
      await new UseFigmaAdapter({ client, token: "tok" }).listTopLevelFrames("F");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RetryableHttpError);
      expect((err as RetryableHttpError).status).toBe(503);
    }
  });

  it("custom baseUrl overrides default", async () => {
    const seen: string[] = [];
    const client = stub((req) => {
      seen.push(req.url);
      return { status: 200, bodyJson: {} };
    });
    await new UseFigmaAdapter({ client, token: "tok", baseUrl: "https://test.local/v1" }).listTopLevelFrames("F");
    expect(seen[0]).toBe("https://test.local/v1/files/F");
  });

  it("default useFigmaAdapter export throws on every method (placeholder)", async () => {
    const { useFigmaAdapter } = await import("../src/adapters/use-figma-adapter.js");
    await expect(useFigmaAdapter.listTopLevelFrames("X")).rejects.toThrow(/live HTTP adapter not bound/);
    await expect(useFigmaAdapter.getFrameMeta("X", "Y")).rejects.toThrow(/live HTTP adapter not bound/);
    await expect(useFigmaAdapter.exportFrameImage("X", "Y", 1)).rejects.toThrow(/live HTTP adapter not bound/);
    await expect(useFigmaAdapter.getPrototypeGraph("X")).rejects.toThrow(/live HTTP adapter not bound/);
  });
});
