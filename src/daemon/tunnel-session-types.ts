// SPEC-FIGMA-008 — Tunnel session orchestrator types.
// Split out from tunnel-session-manager.ts to keep the manager under the
// file-size cap (NFR-06).

import type { TunnelAdapter } from "./tunnel-adapter.js";

export type TunnelManagerStatus =
  | "idle"
  | "pending_confirm"
  | "declined"
  | "attached"
  | "expired"
  | "revoked"
  | "closed_clean";

export interface PluginStatusStripPortLike {
  set(state: string): void;
  current(): string;
}

export interface PluginStorageLike {
  pluginData: Map<string, string>;
  clientStorage: {
    setAsync(key: string, value: string): Promise<void>;
    getAsync(key: string): Promise<string | undefined>;
    deleteAsync(key: string): Promise<void>;
  };
}

export interface AttachedSessionView {
  readonly tunnel_session_id: string;
  readonly bearer: string;
  readonly status: TunnelManagerStatus;
  readonly bearer_sha256: string;
  readonly ttl_ms: number;
}

export interface TunnelCallRequest {
  readonly bearer: string;
  readonly tunnel_session_id: string;
  readonly mcp_method: string;
  readonly tool_name?: string;
  readonly resource_uri?: string;
}

export interface TunnelCallResponse {
  readonly status: 200 | 401;
  readonly body: Record<string, string>;
}

export interface TunnelSessionManagerOptions {
  readonly adapter: TunnelAdapter;
  readonly profileId: string;
  readonly auditPath?: string;
  readonly auditEmit?: (row: Record<string, unknown>) => void;
  readonly stdout?: { write: (line: string) => void } | NodeJS.WriteStream;
  readonly statusStrip?: PluginStatusStripPortLike;
  readonly pluginStorage?: PluginStorageLike;
  readonly pendingConfirmTimeoutMs?: number;
}
