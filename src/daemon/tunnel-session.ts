// SPEC-FIGMA-008 REQ-04, NFR-05 — TunnelSession value type.
// Pure data + pure derivations; no I/O. AC-T5/AC-T6/AC-T8 oracles depend on
// the bearerSha256 = sha256Hex(bearer + ":" + salt) byte-equality and on the
// isExpired clock-pure predicate.

import { createHash, randomBytes } from "node:crypto";

export interface TunnelSessionConstructorInput {
  readonly bearer: string;
  readonly salt: string;
  readonly attachedAt?: number;
  readonly ttlMs?: number;
  readonly tunnel_session_id?: string;
}

const DEFAULT_TTL_MS = 28_800_000;

export class TunnelSession {
  readonly bearer: string;
  readonly salt: string;
  readonly attachedAt: number;
  readonly ttlMs: number;
  readonly tunnel_session_id: string;

  constructor(input: TunnelSessionConstructorInput) {
    this.bearer = input.bearer;
    this.salt = input.salt;
    this.attachedAt = input.attachedAt ?? 0;
    // @AX:NOTE:[AUTO] — REQ-04 ttl <= 28_800_000 ms (8h) is hard cap. AC-T2 and the spec table both pin this; reducing the cap is fine but raising it breaks AC-T2.
    // Reject NaN / -Infinity / negative inputs — auditor Low-1 (CWE-693): NaN TTL would
    // produce a session that never expires because `now >= attachedAt + NaN` is always false.
    const requested = input.ttlMs;
    const validRequested = (typeof requested === "number" && Number.isFinite(requested) && requested >= 0)
      ? requested
      : DEFAULT_TTL_MS;
    this.ttlMs = Math.min(validRequested, DEFAULT_TTL_MS);
    this.tunnel_session_id = input.tunnel_session_id ?? generateTunnelSessionId();
  }

  get bearerSha256(): string {
    return createHash("sha256").update(this.bearer + ":" + this.salt).digest("hex");
  }

  isExpired(now: number): boolean {
    return now >= this.attachedAt + this.ttlMs;
  }

  static createWithRandomSalt(input: { bearer: string; ttlMs?: number; attachedAt?: number; tunnel_session_id?: string }): TunnelSession {
    const salt = randomBytes(16).toString("hex");
    return new TunnelSession({ ...input, salt });
  }

  static createWithRandomBearer(input?: { ttlMs?: number; attachedAt?: number; tunnel_session_id?: string }): TunnelSession {
    const bearer = generateRandomBearer();
    const salt = randomBytes(16).toString("hex");
    return new TunnelSession({ ...input, bearer, salt });
  }
}

// REQ-04: bearer ≥32 base64url chars after `bearer_` prefix. AC-T2 oracle pins regex `^bearer_[A-Za-z0-9_-]{32,}$`.
export function generateRandomBearer(): string {
  // 32 raw bytes → ~43 base64url chars (without padding). Comfortably ≥ 32.
  const raw = randomBytes(32);
  const b64u = raw.toString("base64url");
  return "bearer_" + b64u;
}

export function generateTunnelSessionId(): string {
  // AC-T1 oracle: tunnel_session_id matches /^ts_[A-Za-z0-9_-]{16,}$/.
  const raw = randomBytes(16);
  return "ts_" + raw.toString("base64url");
}

export function tunnelUrlHash8(tunnelUrl: string): string {
  // AC-T2: status strip + stdout show only first 8 hex chars of sha256(url).
  return createHash("sha256").update(tunnelUrl).digest("hex").slice(0, 8);
}
