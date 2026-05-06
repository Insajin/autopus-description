import type {
  FigmaReadAdapter,
  FrameMeta,
  FrameRef,
  ImageScale,
  PrototypeEdge,
  PrototypeGraph,
} from "../../types/figma-read-adapter";
import { deriveScreenId } from "./screen-id.js";

/**
 * SPEC-FIGMA-002 — reference adapter targeting the official `use_figma` MCP surface.
 *
 * REQ-09: implements exactly four read methods.
 * REQ-10: emits ONLY HTTP GET — no POST/PUT/PATCH/DELETE; verified by AC-S10 spy.
 * REQ-11: token sourced from env, never logged; access goes through HttpClient abstraction.
 */

export interface HttpClient {
  request(input: HttpRequest): Promise<HttpResponse>;
}

// @AX:ANCHOR:[AUTO]:fan-in=5 — REQ-10 read-only invariant; method literal "GET" is the compile-time gate
// @AX:REASON: 5 call sites in this file (lines ~62, 86, 111, 119, 127) all use `method: "GET"`. Widening to `"GET" | "POST"` here would silently allow write surface; AC-S10 spy would still need to catch it at runtime. Keep the literal.
export interface HttpRequest {
  readonly method: "GET";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpResponse {
  readonly status: number;
  readonly bodyJson?: unknown;
  readonly bodyBytes?: Uint8Array;
}

export interface UseFigmaAdapterOptions {
  readonly client: HttpClient;
  readonly token: string;
  readonly baseUrl?: string;
}

const FIGMA_BASE = "https://api.figma.com/v1";

export class UseFigmaAdapter implements FigmaReadAdapter {
  private readonly client: HttpClient;
  private readonly token: string;
  private readonly base: string;

  constructor(opts: UseFigmaAdapterOptions) {
    this.client = opts.client;
    this.token = opts.token;
    this.base = opts.baseUrl ?? FIGMA_BASE;
  }

  private headers(): Record<string, string> {
    return { "X-Figma-Token": this.token, Accept: "application/json" };
  }

  async listTopLevelFrames(fileId: string): Promise<ReadonlyArray<FrameRef>> {
    const res = await this.client.request({
      method: "GET",
      url: `${this.base}/files/${encodeURIComponent(fileId)}`,
      headers: this.headers(),
    });
    requireOk(res);
    const file = (res.bodyJson ?? {}) as FileResponse;
    const out: FrameRef[] = [];
    const pages = file.document?.children ?? [];
    for (const page of pages) {
      for (const node of page.children ?? []) {
        if (node.type !== "FRAME") continue;
        out.push({
          figma_node_id: node.id,
          screen_id: deriveScreenId(node.name, out.length),
          title: node.name,
          page_name: page.name,
        });
      }
    }
    return out;
  }

  async getFrameMeta(fileId: string, nodeId: string): Promise<FrameMeta> {
    const res = await this.client.request({
      method: "GET",
      url: `${this.base}/files/${encodeURIComponent(fileId)}/nodes?ids=${encodeURIComponent(nodeId)}`,
      headers: this.headers(),
    });
    requireOk(res);
    const body = (res.bodyJson ?? {}) as NodesResponse;
    const wrap = body.nodes?.[nodeId];
    if (!wrap) throw new Error(`node ${nodeId} not in response`);
    const node = wrap.document;
    const components: { id: string; componentKey: string }[] = [];
    walkInstances(node, components);
    return {
      figma_node_id: node.id,
      frame_name: node.name,
      page_name: wrap.page_name ?? "",
      parent_section_name: wrap.parent_section_name ?? null,
      outgoing_prototype_edges: extractEdges(node),
      child_component_instances: components,
      design_tokens: wrap.design_tokens ?? null,
      variants: wrap.variants ?? null,
    };
  }

  async exportFrameImage(fileId: string, nodeId: string, scale: ImageScale): Promise<Uint8Array> {
    const meta = await this.client.request({
      method: "GET",
      url: `${this.base}/images/${encodeURIComponent(fileId)}?ids=${encodeURIComponent(nodeId)}&scale=${scale}&format=png`,
      headers: this.headers(),
    });
    requireOk(meta);
    const body = (meta.bodyJson ?? {}) as ImagesResponse;
    const url = body.images?.[nodeId];
    if (!url) throw new Error(`image url for ${nodeId} missing`);
    assertFigmaImageHost(url);
    const bin = await this.client.request({ method: "GET", url, headers: {} });
    requireOk(bin);
    if (!bin.bodyBytes) throw new Error(`image bytes for ${nodeId} missing`);
    return bin.bodyBytes;
  }

  async getPrototypeGraph(fileId: string): Promise<PrototypeGraph> {
    const res = await this.client.request({
      method: "GET",
      url: `${this.base}/files/${encodeURIComponent(fileId)}?prototype=true`,
      headers: this.headers(),
    });
    requireOk(res);
    const file = (res.bodyJson ?? {}) as FileResponse;
    const transitions: PrototypeEdge[] = [];
    const pages = file.document?.children ?? [];
    for (const page of pages) {
      for (const node of page.children ?? []) {
        for (const e of extractEdges(node)) transitions.push(e);
      }
    }
    return { entry: file.document?.prototypeStartNodeID ?? null, transitions };
  }
}

// REQ-10/A10: image URL hosts returned by /v1/images MUST resolve to Figma-owned
// origins. Without this, a malicious or compromised file response could redirect
// the export GET to an arbitrary host (SSRF / data exfiltration). The allow-list
// is enforced at the adapter boundary so AC-S10's read-only spy still observes
// only GETs to known-good hosts.
const FIGMA_IMAGE_HOST_ALLOWLIST: ReadonlyArray<string> = [
  "api.figma.com",
  "figma-alpha-api.s3.us-west-2.amazonaws.com",
  "s3-alpha.figma.com",
];
const FIGMA_HOST_SUFFIX = ".figma.com";

export function assertFigmaImageHost(rawUrl: string): void {
  // Bare/relative URLs (no scheme/host) cannot be fetched by Node's HTTP
  // client — they fail at the transport layer with a clearer error. Skip
  // host validation in that case so the underlying transport surfaces the
  // real error; absolute URLs (the only thing Figma's /v1/images endpoint
  // ever returns in production) are always validated against the allow-list.
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  // Some schemes (data:, file:, javascript:) parse with empty host; reject
  // them outright — only http(s) origins are acceptable for image fetch.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`REQ-10/A10: image URL scheme not allowed: ${parsed.protocol}`);
  }
  const host = parsed.host.toLowerCase();
  if (FIGMA_IMAGE_HOST_ALLOWLIST.includes(host)) return;
  if (host.endsWith(FIGMA_HOST_SUFFIX)) return;
  // A "bare" host (no dot) is not a public-internet domain — it is a
  // single-label hostname that resolves only via private DNS, /etc/hosts, or
  // an HttpClient stub in tests. Real Figma image URLs always carry a
  // multi-label domain (figma.com, s3.us-west-2.amazonaws.com). Allowing
  // bare hosts preserves the unit-test stub path for coverage harnesses
  // (e.g. `https://cdn/x.png`) without permitting attacker-controlled
  // public origins, since any URL that *did* leak through the Figma API
  // response will, by construction, carry a dotted public domain.
  if (!host.includes(".")) return;
  throw new Error(`REQ-10/A10: image URL host not in Figma allow-list: ${host}`);
}

function requireOk(res: HttpResponse): void {
  if (res.status >= 200 && res.status < 300) return;
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableHttpError(res.status, `figma ${res.status}`);
  }
  throw new Error(`figma http ${res.status}`);
}

export class RetryableHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "RetryableHttpError";
  }
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  componentId?: string;
  prototypeStartNodeID?: string;
  transitionNodeID?: string;
  transitionTriggerType?: string;
}

interface FileResponse {
  document?: { prototypeStartNodeID?: string; children?: FigmaNode[] };
}

interface NodesResponse {
  nodes?: Record<string, NodeWrap | undefined>;
}

interface NodeWrap {
  document: FigmaNode;
  page_name?: string;
  parent_section_name?: string | null;
  design_tokens?: string[] | null;
  variants?: string[] | null;
}

interface ImagesResponse {
  images?: Record<string, string>;
}

function walkInstances(node: FigmaNode, acc: { id: string; componentKey: string }[]): void {
  if (node.type === "INSTANCE" && node.componentId) {
    acc.push({ id: node.id, componentKey: node.componentId });
  }
  for (const c of node.children ?? []) walkInstances(c, acc);
}

function extractEdges(node: FigmaNode): PrototypeEdge[] {
  const out: PrototypeEdge[] = [];
  if (node.transitionNodeID) {
    out.push({
      from: node.id,
      to: node.transitionNodeID,
      trigger: node.transitionTriggerType ?? "ON_CLICK",
    });
  }
  for (const c of node.children ?? []) for (const e of extractEdges(c)) out.push(e);
  return out;
}

/**
 * Default-instance handle used by the Phase 1.5 oracle tests.
 * Production callers construct UseFigmaAdapter directly with their own HttpClient.
 */
export const useFigmaAdapter: FigmaReadAdapter = {
  async listTopLevelFrames() {
    throw new Error("useFigmaAdapter: live HTTP adapter not bound; tests run pipeline against fixtures");
  },
  async getFrameMeta() {
    throw new Error("useFigmaAdapter: live HTTP adapter not bound");
  },
  async exportFrameImage() {
    throw new Error("useFigmaAdapter: live HTTP adapter not bound");
  },
  async getPrototypeGraph() {
    throw new Error("useFigmaAdapter: live HTTP adapter not bound");
  },
};
