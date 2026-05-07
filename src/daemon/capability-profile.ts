// SPEC-FIGMA-006 REQ-10: Client capability profile detection.
// Maps an attaching client's transport class to its capability list, and
// produces an audit row with `event:"client_profile_attached"`.
//
// @AX:NOTE: [AUTO] AC-S11 oracle values pinned: stdio + http →
// `["resources.read","tools.call"]` (exact array, exact order). tunnel →
// `["resources.read","tools.call","fallback.polling"]`. Reordering or aliasing
// either array breaks the audit-row equality assertion in AC-S11; the
// `client_profile_attached` rows are downstream consumed for transport-class
// telemetry, so the order is part of the public contract.

export type ClientTransport = "stdio" | "http" | "tunnel";

export interface AttachInput {
  client_id: string;
  transport: ClientTransport;
}

export interface CapabilityProfile {
  client_id: string;
  transport: ClientTransport;
  capabilities: string[];
}

const BASE_CAPS = ["resources.read", "tools.call"];
const TUNNEL_FALLBACK = "fallback.polling";

export function buildCapabilityProfile(input: AttachInput): CapabilityProfile {
  const caps =
    input.transport === "tunnel"
      ? [...BASE_CAPS, TUNNEL_FALLBACK]
      : [...BASE_CAPS];
  // Defensive de-dup (preserves first-occurrence order).
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const c of caps) {
    if (!seen.has(c)) {
      seen.add(c);
      dedup.push(c);
    }
  }
  return {
    client_id: input.client_id,
    transport: input.transport,
    capabilities: dedup,
  };
}
