/**
 * SPEC-FIGMA-002 REQ-11: Figma access token redaction.
 *
 * Replaces values matching /figd_[A-Za-z0-9_-]{16,}/g with literal `***`
 * across stdout, stderr, audit log lines, and emitted manifest content.
 */

// @AX:NOTE:[AUTO] — REQ-11 redaction regex locked by AC-S3 oracle; figd_ prefix + ≥16 [A-Za-z0-9_-] chars matches Figma personal access tokens
export const TOKEN_PATTERN = /figd_[A-Za-z0-9_-]{16,}/g;
export const REDACTED = "***";

// @AX:ANCHOR:[AUTO]:fan-in=5 — REQ-11 token redaction gate; INV-005 zero-occurrence invariant
// @AX:REASON: callers — src/audit-logger.ts, src/cli.ts, src/manifest-writer.ts, src/pipeline.ts, src/read-pipeline.ts. Bypassing this function leaks figd_* tokens into stdout/stderr/audit/manifest (BS-001 X4 mitigation).
export function redact(text: string): string {
  return text.replace(TOKEN_PATTERN, REDACTED);
}

export const redactTokens = redact;

export interface CaptureOptions {
  readonly fixturePath: string;
  readonly token: string;
  readonly debug?: boolean;
  readonly collectAuditLines?: boolean;
}

/**
 * Runs the read pipeline against a fixture and returns a single concatenated string
 * of stdout + stderr + manifest text + audit JSONL lines, all passed through redact().
 */
export async function runReadAdapterWithCapture(opts: CaptureOptions): Promise<string> {
  const { runReadPipelineCaptured } = await import("./read-pipeline.js");
  return runReadPipelineCaptured(opts);
}

export function redactJsonValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redact(value) as unknown as T;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactJsonValue(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactJsonValue(v);
  }
  return out as unknown as T;
}

export interface WritableLike {
  write(chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: (e?: Error | null) => void): boolean;
}

export function wrapStream(stream: WritableLike): WritableLike {
  const original = stream.write.bind(stream);
  return {
    write(chunk, encoding, cb) {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const safe = redact(text);
      return original(safe, encoding, cb);
    },
  };
}

export function countTokenMatches(text: string): number {
  const m = text.match(TOKEN_PATTERN);
  return m ? m.length : 0;
}

// @AX:NOTE:[AUTO] — SPEC-FIGMA-008 REQ-08 / NFR-03: TUNNEL_URL_PATTERN and redactTunnelUrl are additive to and independent from TOKEN_PATTERN/redact (figd_ surface). AC-T9 oracle asserts zero matches of /https:\/\/[a-z0-9-]+\.trycloudflare\.com/ in any audit-emitted serialized JSON. Callers that need both surfaces MUST compose redact() and redactTunnelUrl() explicitly — neither calls the other.
// SPEC-FIGMA-008 REQ-08 — additive: mask cloudflared trycloudflare.com URLs.
// Independent from `redact`/`TOKEN_PATTERN` (figd_ surface). Composing both is the caller's responsibility.
// Path char class excludes `"` and `'` so the pattern stops at JSON/string delimiters when the URL is embedded in serialized JSON (AC-T9). Optional `:port` group prevents path leakage when a non-standard port is injected.
export const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?::\d+)?(?:\/[^"'\s]*)?/g;

export function redactTunnelUrl(text: string): string {
  return text.replace(TUNNEL_URL_PATTERN, REDACTED);
}
