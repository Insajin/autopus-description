// SPEC-FIGMA-004 W4 — stale badge component (REQ-10, REQ-21).
//
// Two render modes driven by AC-S9 / AC-S21:
//   count <= STALE_DIGEST_THRESHOLD  → inline single-row badge ("stale")
//   count >  STALE_DIGEST_THRESHOLD  → digest banner with toggleable list
//
// The component is purely presentational; `detectStale` in
// `apps/review-ui/src/lib/stale-detector.ts` produces the data.

"use client";

import { useState } from "react";
import { STALE_DIGEST_THRESHOLD } from "../lib/stale-detector.js";

export interface StaleBadgeProps {
  count: number;
  screenIds?: ReadonlyArray<string>;
}

export default function StaleBadge({ count, screenIds = [] }: StaleBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  if (count <= 0) return null;

  if (count <= STALE_DIGEST_THRESHOLD) {
    return (
      <span
        className="stale-badge stale-badge-inline"
        role="status"
        data-mode="inline"
      >
        stale
      </span>
    );
  }

  return (
    <div
      className="stale-badge stale-badge-digest"
      role="status"
      data-mode="digest"
    >
      <span className="stale-badge-summary">
        {count} frames stale — review batch
      </span>
      <button
        type="button"
        className="stale-badge-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
      {expanded && screenIds.length > 0 ? (
        <ul className="stale-badge-list">
          {screenIds.map((sid) => (
            <li key={sid}>{sid}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
