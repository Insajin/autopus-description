// SPEC-FIGMA-004 — mock Figma write API used by Phase 1.5 acceptance scaffolds.
// Provides spy-recorded methods covering every adapter contract:
//   annotation_card    → createText / deleteNode
//   descriptions_page  → getOrCreatePage / createTextOnPage / deleteNode
//   comment            → commentPost / deleteComment
//   plugin_data        → setPluginData / clearPluginData
//   frame_name         → getFrameName / setFrameName / readFrameName
// And exposes failure injection hooks for AC-S7 (Plugin Bridge fallback) and
// AC-S8 (token redaction) — `mcpResponse`, `writeFailureMessage`, `slackToken`.

export type MockHttpResponse = { status: number; body: unknown };

export interface MockFigmaWriteServerOptions {
  createTextReturnsNodeId?: string;
  initialFrameName?: string;
  mcpResponse?: MockHttpResponse;
  writeFailureMessage?: string;
  slackToken?: string;
}

interface CallLog {
  createText: Array<{
    frameId: string;
    text: string;
    position?: { x: number; y: number };
    layout?: string;
    areaCallouts?: unknown[];
    documentPosition?: string;
    visualPolicy?: unknown;
  }>;
  deleteNode: Array<{ node_id: string }>;
  getOrCreatePage: Array<{ pageName: string; fileKey?: string }>;
  createTextOnPage: Array<{ pageId: string; text: string }>;
  commentPost: Array<{ fileKey: string; frameId: string; text: string }>;
  deleteComment: Array<{ fileKey: string; commentId: string }>;
  setPluginData: Array<{ frameId: string; key: string; value: string }>;
  clearPluginData: Array<{ frameId: string; key: string }>;
  getFrameName: Array<{ nodeId: string }>;
  setFrameName: Array<{ nodeId: string; name: string }>;
  mcpAttempts: Array<{ method: string; args: unknown }>;
}

export interface MockFigmaWriteServer {
  readonly calls: CallLog;
  readFrameName(): string;

  // Figma write surface (the WriteRouter / adapters consume these).
  createText(args: {
    frameId: string;
    text: string;
    position?: { x: number; y: number };
    layout?: string;
    areaCallouts?: unknown[];
    documentPosition?: string;
    visualPolicy?: unknown;
  }): Promise<{ nodeId: string }>;
  deleteNode(args: { node_id: string } | string): Promise<void>;
  getOrCreatePage(args: { pageName: string; fileKey?: string }): Promise<{ pageId: string }>;
  createTextOnPage(args: { pageId: string; text: string }): Promise<{ nodeId: string }>;
  commentPost(args: { fileKey: string; frameId: string; text: string }): Promise<{ commentId: string }>;
  deleteComment(args: { fileKey: string; commentId: string }): Promise<void>;
  setPluginData(args: { frameId?: string; nodeId?: string; key: string; value: string }): Promise<void>;
  clearPluginData(args: { frameId?: string; nodeId?: string; key: string }): Promise<void>;
  getFrameName(nodeId: string): Promise<string>;
  setFrameName(nodeId: string, name: string): Promise<void>;
}

let nodeCounter = 9000;
function nextNodeId(): string {
  nodeCounter += 1;
  return `node-${nodeCounter}`;
}
let commentCounter = 0;
function nextCommentId(): string {
  commentCounter += 1;
  return `cmt-${commentCounter}`;
}

class MockServer implements MockFigmaWriteServer {
  readonly calls: CallLog = {
    createText: [],
    deleteNode: [],
    getOrCreatePage: [],
    createTextOnPage: [],
    commentPost: [],
    deleteComment: [],
    setPluginData: [],
    clearPluginData: [],
    getFrameName: [],
    setFrameName: [],
    mcpAttempts: [],
  };
  private frameName: string;
  private readonly opts: MockFigmaWriteServerOptions;

  constructor(opts: MockFigmaWriteServerOptions = {}) {
    this.opts = opts;
    this.frameName = opts.initialFrameName ?? "Untitled";
  }

  readFrameName(): string {
    return this.frameName;
  }

  private maybeInjectMcpFailure(method: string, args: unknown): void {
    this.calls.mcpAttempts.push({ method, args });
    const r = this.opts.mcpResponse;
    if (r && r.status >= 400) {
      const err = new Error(this.opts.writeFailureMessage ?? `mcp ${r.status}`) as Error & {
        status: number;
        body: unknown;
      };
      err.status = r.status;
      err.body = r.body;
      throw err;
    }
    // Token-redaction tests set writeFailureMessage WITHOUT mcpResponse to
    // force a generic error path (non-permission). Surface that as a plain
    // Error so the router's redactErrorMessage hook runs.
    if (!r && this.opts.writeFailureMessage) {
      throw new Error(this.opts.writeFailureMessage);
    }
  }

  async createText(args: {
    frameId: string;
    text: string;
    position?: { x: number; y: number };
    layout?: string;
    areaCallouts?: unknown[];
    documentPosition?: string;
    visualPolicy?: unknown;
  }) {
    this.maybeInjectMcpFailure("createText", args);
    this.calls.createText.push(args);
    const nodeId = this.opts.createTextReturnsNodeId ?? nextNodeId();
    return { nodeId };
  }

  async deleteNode(arg: { node_id: string } | string) {
    const node_id = typeof arg === "string" ? arg : arg.node_id;
    this.calls.deleteNode.push({ node_id });
  }

  async getOrCreatePage(args: { pageName: string; fileKey?: string }) {
    this.calls.getOrCreatePage.push(args);
    return { pageId: `page-${args.pageName}` };
  }

  async createTextOnPage(args: { pageId: string; text: string }) {
    this.calls.createTextOnPage.push(args);
    return { nodeId: nextNodeId() };
  }

  async commentPost(args: { fileKey: string; frameId: string; text: string }) {
    this.maybeInjectMcpFailure("commentPost", args);
    this.calls.commentPost.push(args);
    return { commentId: nextCommentId() };
  }

  async deleteComment(args: { fileKey: string; commentId: string }) {
    this.calls.deleteComment.push(args);
  }

  async setPluginData(args: { frameId?: string; nodeId?: string; key: string; value: string }) {
    this.maybeInjectMcpFailure("setPluginData", args);
    const frameId = args.frameId ?? args.nodeId ?? "";
    this.calls.setPluginData.push({ frameId, key: args.key, value: args.value });
  }

  async clearPluginData(args: { frameId?: string; nodeId?: string; key: string }) {
    const frameId = args.frameId ?? args.nodeId ?? "";
    this.calls.clearPluginData.push({ frameId, key: args.key });
  }

  async getFrameName(nodeId: string) {
    this.calls.getFrameName.push({ nodeId });
    return this.frameName;
  }

  async setFrameName(nodeId: string, name: string) {
    this.calls.setFrameName.push({ nodeId, name });
    this.frameName = name;
  }
}

export function createMockFigmaWriteServer(
  opts: MockFigmaWriteServerOptions = {},
): MockFigmaWriteServer {
  return new MockServer(opts);
}
