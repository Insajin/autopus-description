// SPEC-FIGMA-008 REQ-01, REQ-02, NFR-02 — additive over SPEC-FIGMA-006 INV-007.
// Three-profile registry: claude-code-local | codex-windows-stdio | claude-cowork-remote.
// AC-T1, AC-T12 oracles: baseline arrays byte-equal to SPEC-FIGMA-006 AC-S11.

export type TransportClass = "stdio" | "http" | "tunnel";

export type ProfileId =
  | "claude-code-local"
  | "codex-windows-stdio"
  | "claude-cowork-remote";

export interface RegisteredProfile {
  readonly profile_id: ProfileId;
  readonly transport: TransportClass;
  readonly capabilities: readonly string[];
  readonly default_capabilities_locked: true;
}

export interface MatchInput {
  readonly clientName: string;
  readonly transport: TransportClass | string;
}

// @AX:NOTE:[AUTO] — AC-T1 oracle pins canonical order ["claude-code-local","codex-windows-stdio","claude-cowork-remote"]; AC-T12 oracle requires capability arrays byte-equal to SPEC-FIGMA-006 AC-S11 baseline (SPEC-FIGMA-008 REQ-01/REQ-02). Reordering profiles or altering capability strings breaks both oracles without a SPEC revision.
// Byte-equal to SPEC-FIGMA-006 AC-S11 baseline. Do NOT reorder or alias.
const CLAUDE_CODE_LOCAL: RegisteredProfile = Object.freeze({
  profile_id: "claude-code-local",
  transport: "stdio",
  capabilities: Object.freeze(["resources.read", "tools.call"] as const),
  default_capabilities_locked: true,
});

const CODEX_WINDOWS_STDIO: RegisteredProfile = Object.freeze({
  profile_id: "codex-windows-stdio",
  transport: "http",
  capabilities: Object.freeze(["resources.read", "tools.call"] as const),
  default_capabilities_locked: true,
});

const CLAUDE_COWORK_REMOTE: RegisteredProfile = Object.freeze({
  profile_id: "claude-cowork-remote",
  transport: "tunnel",
  capabilities: Object.freeze([
    "resources.read",
    "tools.call",
    "fallback.polling",
  ] as const),
  default_capabilities_locked: true,
});

const PROFILES: readonly RegisteredProfile[] = Object.freeze([
  CLAUDE_CODE_LOCAL,
  CODEX_WINDOWS_STDIO,
  CLAUDE_COWORK_REMOTE,
]);

export class CapabilityProfileRegistry {
  list(): readonly RegisteredProfile[] {
    return PROFILES;
  }

  getProfile(profile_id: string): RegisteredProfile | null {
    for (const p of PROFILES) {
      if (p.profile_id === profile_id) return p;
    }
    return null;
  }

  matchProfile(input: MatchInput): RegisteredProfile | null {
    const name = (input.clientName ?? "").toLowerCase();

    // 1. Name-based match (case-insensitive substring) — first match wins.
    if (name.includes("claude-code")) return CLAUDE_CODE_LOCAL;
    if (name.includes("codex-windows")) return CODEX_WINDOWS_STDIO;
    if (name.includes("claude-cowork")) return CLAUDE_COWORK_REMOTE;

    // 2. Transport literal fallback.
    switch (input.transport) {
      case "stdio":
        return CLAUDE_CODE_LOCAL;
      case "http":
        return CODEX_WINDOWS_STDIO;
      case "tunnel":
        return CLAUDE_COWORK_REMOTE;
      default:
        // 3. Unknown transport — fail closed.
        return null;
    }
  }
}
