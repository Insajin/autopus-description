// SPEC-FIGMA-004 W4 — Dashboard server component.
//
// Server-side loads the manifest path supplied by env (REVIEW_MANIFEST_PATH).
// Interactive surface lives in <Dashboard /> as a client component.

import Dashboard from "../components/Dashboard.js";
import { loadManifest } from "../lib/manifest-loader.js";
import { detectStale } from "../lib/stale-detector.js";
import type { ManifestEntry } from "@autopus/write-router/types";

interface ManifestShape {
  pilot_metadata?: {
    total_token_cost?: number;
    pilot_date?: string;
    pm_reviewer_id?: string;
  };
  frames?: ManifestEntry[];
}

export const dynamic = "force-dynamic";

async function loadManifestData(): Promise<{
  manifest: ManifestShape | null;
  valid: boolean;
}> {
  const path = process.env.REVIEW_MANIFEST_PATH;
  if (!path) return { manifest: null, valid: false };
  const result = await loadManifest<ManifestShape>(path);
  return { manifest: result.data ?? null, valid: result.valid };
}

export default async function DashboardPage() {
  const { manifest, valid } = await loadManifestData();
  if (!manifest || !manifest.frames) {
    return (
      <main className="dashboard-empty">
        <h1>SPEC-FIGMA-004 review dashboard</h1>
        <p>
          Configure <code>REVIEW_MANIFEST_PATH</code> environment variable to
          load a manifest.
        </p>
      </main>
    );
  }
  const staleResult = detectStale(null, {
    frames: manifest.frames as Array<{
      screen_id: string;
      source_hash: string;
    }>,
  });
  const slackConfigured = Boolean(process.env.SLACK_BOT_TOKEN);

  return (
    <Dashboard
      frames={manifest.frames}
      totalTokenCost={manifest.pilot_metadata?.total_token_cost}
      pilotDate={manifest.pilot_metadata?.pilot_date}
      reviewerId={manifest.pilot_metadata?.pm_reviewer_id}
      staleScreenIds={staleResult.stale}
      manifestValid={valid}
      slackConfigured={slackConfigured}
    />
  );
}
