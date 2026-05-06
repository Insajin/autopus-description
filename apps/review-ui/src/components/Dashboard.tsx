// SPEC-FIGMA-004 W4 — Dashboard client wrapper (page-level interactivity).
//
// Owns the per-frame action handlers. The page (server component) loads the
// manifest and forwards the parsed data; this client component renders the
// FrameRow list and dispatches Apply/Edit/Skip/Escalate to the API routes.

"use client";

import { useState } from "react";
import type { ManifestEntry } from "@autopus/write-router/types";
import FrameRow from "./FrameRow.js";
import FrameEditor from "./FrameEditor.js";
import StaleBadge from "./StaleBadge.js";
import TokenStrip from "./TokenStrip.js";

export interface DashboardProps {
  frames: ManifestEntry[];
  totalTokenCost?: number;
  pilotDate?: string;
  reviewerId?: string;
  staleScreenIds?: ReadonlyArray<string>;
  manifestValid?: boolean;
  slackConfigured?: boolean;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default function Dashboard({
  frames,
  totalTokenCost,
  pilotDate,
  reviewerId,
  staleScreenIds = [],
  manifestValid = true,
  slackConfigured = false,
}: DashboardProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState(frames);

  const stale = new Set(staleScreenIds);

  const handleApply = async (entry: ManifestEntry) => {
    const res = await postJson("/api/apply", { entry });
    if (res.ok) {
      setApplied((prev) => new Set(prev).add(entry.screen_id));
    }
  };

  const handleSave = (updated: ManifestEntry) => {
    setEntries((prev) =>
      prev.map((e) => (e.screen_id === updated.screen_id ? updated : e)),
    );
    setEditing(null);
  };

  const handleEscalate = async (entry: ManifestEntry) => {
    await postJson("/api/feedback", {
      action: "escalate",
      screen_id: entry.screen_id,
      frame_id: entry.frame_id,
    });
  };

  const handleSkip = async (entry: ManifestEntry) => {
    await postJson("/api/feedback", {
      action: "skip",
      screen_id: entry.screen_id,
    });
  };

  return (
    <main className="dashboard">
      <TokenStrip
        totalTokenCost={totalTokenCost}
        pilotDate={pilotDate}
        reviewerId={reviewerId}
      />
      {staleScreenIds.length > 0 ? (
        <StaleBadge count={staleScreenIds.length} screenIds={staleScreenIds} />
      ) : null}

      <ul className="frame-list">
        {entries.map((entry) => (
          <li key={entry.screen_id} className="frame-list-item">
            {editing === entry.screen_id ? (
              <FrameEditor
                entry={entry}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <FrameRow
                entry={entry}
                onApply={handleApply}
                onEdit={(e) => setEditing(e.screen_id)}
                onSkip={handleSkip}
                onEscalate={handleEscalate}
                isApplied={applied.has(entry.screen_id)}
                isStale={stale.has(entry.screen_id)}
                slackConfigured={slackConfigured}
                manifestValid={manifestValid}
              />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
