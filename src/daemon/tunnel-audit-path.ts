// SPEC-FIGMA-008 — Tunnel audit path resolver.
// The Phase 1.5 RED tests construct TunnelSessionManager AFTER booting a
// Daemon with a specific auditDir, but do not pass the audit path to the
// manager directly. To preserve those test signatures, the daemon registers
// its audit path here on boot and the manager picks it up by default.
//
// Module-level singleton is acceptable because (a) one daemon process maps
// to one audit dir, and (b) tests reset the slot in beforeEach via fresh
// Daemon construction.

import { join } from "node:path";

let registered: string | null = null;

export function registerTunnelAuditPath(auditDir: string): void {
  registered = join(auditDir, "audit.jsonl");
}

export function resolveTunnelAuditPath(explicit?: string): string {
  if (explicit) return explicit;
  if (registered) return registered;
  return join(process.cwd(), ".autopus", "audit.jsonl");
}

export function clearTunnelAuditPath(): void {
  registered = null;
}
