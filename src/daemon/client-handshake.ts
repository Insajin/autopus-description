// SPEC-FIGMA-008 REQ-02 — mcp-client-profile negotiation handshake.
// AC-T3 oracle: returns {profile_id, capabilities, protocol_version, transport}
// (set equality). Also emits one client_profile_attached audit row whose
// additional fields {profile_id, tunnel_session_id, attached_at} extend the
// SPEC-FIGMA-006 baseline emission.
//
// Split out from server.ts to keep that file under the NFR-06 line cap.

import { CapabilityProfileRegistry, type TransportClass } from "./capability-profile-registry.js";
import type { DaemonAuditWriter } from "./audit-writer.js";

export interface HandshakeInput {
  readonly clientName: string;
  readonly transport: TransportClass | string;
  readonly tunnelSessionId?: string | null;
}

export interface HandshakeAdvert {
  readonly profile_id: string;
  readonly capabilities: readonly string[];
  readonly protocol_version: 1;
  readonly transport: string;
}

export function performClientHandshake(
  audit: DaemonAuditWriter,
  input: HandshakeInput,
): HandshakeAdvert {
  const registry = new CapabilityProfileRegistry();
  const matched = registry.matchProfile({
    clientName: input.clientName,
    transport: input.transport as TransportClass,
  });
  if (!matched) {
    throw new Error(
      `no profile matched for client=${input.clientName} transport=${String(input.transport)}`,
    );
  }
  audit.emitEvent({
    event: "client_profile_attached",
    client_id: input.clientName,
    transport: input.transport,
    capabilities: matched.capabilities,
    profile_id: matched.profile_id,
    tunnel_session_id: input.tunnelSessionId ?? null,
    attached_at: new Date().toISOString(),
  });
  return {
    profile_id: matched.profile_id,
    capabilities: matched.capabilities,
    protocol_version: 1,
    transport: input.transport as string,
  };
}
