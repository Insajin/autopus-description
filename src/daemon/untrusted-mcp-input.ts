// SPEC-FIGMA-006 REQ-07: Wrap every string MCP tool argument through the
// untrusted-fence (escapes angle brackets, prefixes with delimiters) AND
// then through the figd_ token redactor before it reaches prompt
// concatenation or audit emission.
//
// @AX:WARN: [AUTO] Trust boundary — `sanitizeMcpInput` is the ONLY sanctioned
// path for MCP tool string arguments to enter daemon prompt construction or
// audit emission. Bypassing this function lets a malicious MCP client inject
// closing fence tags or leak figd_ tokens into persisted audit rows.
// @AX:REASON: REQ-07 + Q-SEC-01 + AC-S8 — fence-and-redact ordering is
// load-bearing: redact AFTER fence so that token-shaped strings inside the
// untrusted body are still masked before any concatenation or hashing.

import { createHash } from "node:crypto";
import * as untrustedFence from "../prompts/untrusted-fence.js";
import * as tokenRedactor from "../token-redactor.js";

export interface SanitizedArg {
  /** The original key. */
  key: string;
  /** Wrapped + redacted text suitable for inclusion in a prompt. */
  wrapped: string;
}

export interface SanitizeResult {
  wrapped: SanitizedArg[];
  /** sha256 of the concatenated `wrapped` strings (post-redaction). */
  sha256: string;
}

export function sanitizeMcpInput(args: Record<string, unknown>): SanitizeResult {
  const wrapped: SanitizedArg[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "string") continue;
    const fenced = untrustedFence.wrapUntrustedFigmaText({
      kind: "node_description",
      content: v,
    });
    const safe = tokenRedactor.redact(fenced);
    wrapped.push({ key: k, wrapped: safe });
  }
  const concat = wrapped.map((w) => w.wrapped).join("\n");
  const sha256 = createHash("sha256").update(concat).digest("hex");
  return { wrapped, sha256 };
}
