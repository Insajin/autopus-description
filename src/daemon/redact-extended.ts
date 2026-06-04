// SPEC-FIGMA-007 REQ-10, REQ-13, NFR-03 — extended redact pass for daemon-side
// audit retention. Wraps `src/redact-patterns.ts` source strings into runtime
// RegExp objects and provides a single `redactExtended` function that strips:
//   - figd_* tokens (Figma personal access tokens)
//   - xoxb-* tokens (Slack bot tokens)
//   - Bearer/bearer ... tokens (OAuth/JWT)
//   - absolute privileged path prefixes (/Users/, /home/, C:\Users\) and the
//     first path segment after the prefix (so `/Users/secret/path` becomes
//     `/Users/***/path` rather than leaking the user name).
//
// Frozen `src/token-redactor.ts::redact` (figd_ only) is preserved unchanged.
// This module is the additive outer layer NFR-03 mandates.

import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
  REDACTED,
} from "../redact-patterns.js";
import { redactTunnelUrl } from "../token-redactor.js";

const FIGD_RE = new RegExp(FIGD_PATTERN_SOURCE, "g");
const XOXB_RE = new RegExp(XOXB_PATTERN_SOURCE, "g");
const BEARER_RE = new RegExp(BEARER_PATTERN_SOURCE, "g");

// Build absolute-path scrubbers. Each entry is a string source representing a
// literal prefix (e.g. "/Users/", "/home/", "C:\\\\Users\\\\"). The redact
// pass replaces `<prefix><segment>` with `***` so the persisted file contains
// neither the prefix (which is itself a privileged-path identifier per
// AC-S7's negation regex) nor the user-name segment.
const ABSOLUTE_PATH_REGEXES: RegExp[] = ABSOLUTE_PATH_PATTERNS_SOURCE.map(
  (src) => new RegExp(`${src}[^/\\\\\\s]*`, "g"),
);

export function redactExtended(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  let out = input.replace(FIGD_RE, REDACTED);
  out = out.replace(XOXB_RE, REDACTED);
  out = out.replace(BEARER_RE, REDACTED);
  for (const re of ABSOLUTE_PATH_REGEXES) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

// Composite redactor for the WebSocket wire surface (relay broadcast + plugin
// client send). Covers figd_/xoxb-/bearer/absolute-path (redactExtended) plus
// trycloudflare tunnel URLs — the full secret surface, not just figd_ (audit
// M-3). redactExtended and redactTunnelUrl are independent and compose cleanly.
export function redactWire(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  return redactTunnelUrl(redactExtended(input));
}

export function redactExtendedObject(value: unknown): unknown {
  if (typeof value === "string") return redactExtended(value);
  if (Array.isArray(value)) return value.map(redactExtendedObject);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactExtendedObject(v);
    }
    return out;
  }
  return value;
}

export const EXTENDED_REDACT_PATTERNS = {
  figd: FIGD_RE,
  xoxb: XOXB_RE,
  bearer: BEARER_RE,
  absolutePaths: ABSOLUTE_PATH_REGEXES,
} as const;

// AC-S14 parity surface — re-export the source strings so the integration
// test can assert byte-equal source-of-truth between daemon and plugin.
export {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
};
