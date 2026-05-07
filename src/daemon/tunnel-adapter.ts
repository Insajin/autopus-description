// SPEC-FIGMA-008 REQ-04 — TunnelAdapter abstraction.
// Production adapter is `tunnel-cloudflared.ts`. Tests inject mock adapters.

export interface TunnelAttachResult {
  readonly tunnelUrl: string;
  readonly tunnelSessionId?: string;
}

export interface TunnelAdapter {
  attach(): Promise<TunnelAttachResult>;
  detach(): Promise<void>;
}
