// SPEC-FIGMA-007 mock plugin bridge for integration tests.
// In-memory simulation of the WebSocket bridge between the autopus daemon
// and the sonnylazuardi-fork Figma plugin. Records dispatched plugin commands
// for spy-style assertions and produces deterministic command_result responses.
//
// AC coverage: AC-S2, AC-S3, AC-S4, AC-S5, AC-S8, AC-S12.
// Hard cap: 250 lines (NFR-06).

import { randomBytes } from "node:crypto";

export interface PluginCommand {
  op:
    | "set_annotation"
    | "upsert_descriptions_page_node"
    | "post_comment"
    | "set_plugin_data"
    | "set_frame_name"
    | "noop"
    | "delete_node"
    | "delete_comment"
    | "clear_plugin_data"
    | "restore_frame_name";
  args: Record<string, unknown>;
}

export interface CommandResult {
  pending_id?: string;
  ok: boolean;
  node_ids?: string[];
  error?: string;
}

export interface ApplyRequest {
  pending_id: string;
  source_hash_recomputed: string;
  plugin_session_token?: string;
}

export interface DispatchedCommand {
  command: PluginCommand;
  pendingId?: string;
  at: number;
}

export type ResultFactory = (
  cmd: PluginCommand,
  index: number,
) => CommandResult;

export interface MockPluginBridgeOptions {
  // Deterministic command_result responder. Default: ok=true with synthetic node_ids.
  responder?: ResultFactory;
  // Drop the connection after N successful command_results have been
  // delivered. AC-S8 partial-disconnect oracle.
  dropAfter?: number;
  // Inject an artificial delay (ms) before each command_result.
  responseDelayMs?: number;
}

export class MockPluginBridge {
  readonly dispatched: DispatchedCommand[] = [];
  readonly applyRequests: ApplyRequest[] = [];
  private readonly responder: ResultFactory;
  private readonly dropAfter: number;
  private readonly responseDelayMs: number;
  private dropped = false;
  private successDeliveries = 0;
  // Internal listener registry simulating WebSocket on/off semantics.
  private readonly listeners: Array<(req: ApplyRequest) => void> = [];
  // Track the most recent disconnect timestamp for AC-S8 reconnect oracle.
  private lastDisconnectAt: number | null = null;

  constructor(opts: MockPluginBridgeOptions = {}) {
    this.responder =
      opts.responder ??
      ((cmd, idx) => ({
        ok: true,
        node_ids: [`7:${100 + idx}`],
      }));
    this.dropAfter = opts.dropAfter ?? Number.POSITIVE_INFINITY;
    this.responseDelayMs = opts.responseDelayMs ?? 0;
  }

  // The daemon side calls this to dispatch a single plugin_command and await
  // a command_result back. AC-S2/AC-S3 happy path, AC-S5 zero-call assertion,
  // AC-S8 mid-stream drop.
  async dispatchCommand(
    cmd: PluginCommand,
    pendingId?: string,
  ): Promise<CommandResult> {
    if (this.dropped) {
      throw new Error("plugin_bridge_disconnected");
    }
    const at = Date.now();
    this.dispatched.push({ command: cmd, pendingId, at });
    if (this.responseDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.responseDelayMs));
    }
    const result = this.responder(cmd, this.successDeliveries);
    if (result.ok) {
      this.successDeliveries += 1;
      if (this.successDeliveries >= this.dropAfter) {
        this.dropped = true;
        this.lastDisconnectAt = Date.now();
      }
    }
    return { ...result, pending_id: pendingId };
  }

  // The plugin side simulates the designer clicking [Approve] which then
  // posts an apply_request over the WebSocket bridge to the daemon.
  emitApplyRequest(req: ApplyRequest): void {
    this.applyRequests.push(req);
    for (const fn of this.listeners) fn(req);
  }

  onApplyRequest(fn: (req: ApplyRequest) => void): void {
    this.listeners.push(fn);
  }

  // AC-S8 reconnect path. Resets the dropped flag without clearing the
  // dispatched-command history (so the daemon can replay inverse commands
  // and the test can verify their order).
  reconnect(): void {
    this.dropped = false;
  }

  isDropped(): boolean {
    return this.dropped;
  }

  getDisconnectTime(): number | null {
    return this.lastDisconnectAt;
  }

  reset(): void {
    this.dispatched.length = 0;
    this.applyRequests.length = 0;
    this.dropped = false;
    this.successDeliveries = 0;
    this.lastDisconnectAt = null;
    this.listeners.length = 0;
  }

  // AC-S2/AC-S3: snapshot a frozen view of dispatched calls (for spy-style
  // assertions on call count and last args).
  snapshot(): {
    callCount: number;
    lastCommand: PluginCommand | null;
    lastArgs: Record<string, unknown> | null;
  } {
    const last = this.dispatched.at(-1);
    return {
      callCount: this.dispatched.length,
      lastCommand: last?.command ?? null,
      lastArgs: last?.command.args ?? null,
    };
  }
}

// Generate a deterministic-looking pending_id without colliding across test runs.
export function makePendingId(seed?: string): string {
  const id = seed ?? randomBytes(4).toString("hex");
  const counter = Math.floor(Math.random() * 1000) + 1;
  return `pw-${id}-${counter}`;
}

// Generate a write_id matching the existing SPEC-FIGMA-004 format.
export function makeWriteId(seed?: string): string {
  const id = seed ?? randomBytes(4).toString("hex");
  return `wr-${id}-1`;
}

// Inverse-command synthesizer for AC-S4 / AC-S8 rollback assertions. Reads
// the recorded dispatched commands and produces the expected inverse list
// in reverse order. The daemon's actual inverse logic is exercised by
// daemon-undo-tool.test.ts; this helper is a contract-level oracle.
export function expectedInverseCommands(
  forwards: DispatchedCommand[],
): PluginCommand[] {
  const inverse: PluginCommand[] = [];
  for (let i = forwards.length - 1; i >= 0; i -= 1) {
    const fwd = forwards[i].command;
    if (fwd.op === "set_annotation" || fwd.op === "post_comment") {
      const node_id = (fwd.args.node_id as string) ?? "";
      inverse.push({ op: "delete_node", args: { node_id } });
    } else if (fwd.op === "set_plugin_data") {
      const node_id = (fwd.args.node_id as string) ?? "";
      const key = (fwd.args.key as string) ?? "";
      inverse.push({ op: "clear_plugin_data", args: { node_id, key } });
    } else if (fwd.op === "set_frame_name") {
      const node_id = (fwd.args.node_id as string) ?? "";
      const original_name = (fwd.args.original_name as string) ?? "";
      inverse.push({ op: "restore_frame_name", args: { node_id, original_name } });
    } else if (fwd.op === "upsert_descriptions_page_node") {
      const node_id = (fwd.args.node_id as string) ?? "";
      inverse.push({ op: "delete_node", args: { node_id } });
    } else {
      inverse.push({ op: "noop", args: {} });
    }
  }
  return inverse;
}
