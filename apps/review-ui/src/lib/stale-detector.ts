// SPEC-FIGMA-004 W4 — stale detector (REQ-10, REQ-21, INV-008).
//
// Compares baseline vs current manifest entries by `screen_id` and reports
// frames whose `source_hash` shifted. Detection is observation-only; the
// `regeneratorInvocations` counter stays 0 to encode that no automatic
// regeneration runs (INV-008). When more than 3 frames are stale the
// digest banner mode is signalled (REQ-21 / AC-S21).

export const STALE_DIGEST_THRESHOLD = 3;

export interface StaleManifestFrame {
  screen_id: string;
  source_hash: string;
}

export interface StaleManifest {
  frames: ReadonlyArray<StaleManifestFrame & Record<string, unknown>>;
}

export interface StaleResult {
  stale: string[];
  digestMode: boolean;
  regeneratorInvocations: 0;
}

function indexBySid(manifest: StaleManifest): Map<string, string> {
  const map = new Map<string, string>();
  for (const frame of manifest.frames) {
    if (
      frame &&
      typeof frame.screen_id === "string" &&
      typeof frame.source_hash === "string"
    ) {
      map.set(frame.screen_id, frame.source_hash);
    }
  }
  return map;
}

export function detectStale(
  baseline: StaleManifest | null | undefined,
  current: StaleManifest,
): StaleResult {
  if (!baseline) {
    return { stale: [], digestMode: false, regeneratorInvocations: 0 };
  }
  const baseHashes = indexBySid(baseline);
  const stale: string[] = [];
  for (const frame of current.frames) {
    if (!frame || typeof frame.screen_id !== "string") continue;
    const baseHash = baseHashes.get(frame.screen_id);
    if (baseHash === undefined) continue;
    if (frame.source_hash !== baseHash) {
      stale.push(frame.screen_id);
    }
  }
  return {
    stale,
    digestMode: stale.length > STALE_DIGEST_THRESHOLD,
    regeneratorInvocations: 0,
  };
}
