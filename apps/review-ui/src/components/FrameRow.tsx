// SPEC-FIGMA-004 W4 — FrameRow component (REQ-01..03, REQ-15..16, REQ-20).
//
// Renders a single manifest entry with the four PM actions. The Apply button
// is disabled while the entry is already applied or the manifest is invalid;
// the Escalate button is disabled when Slack is not configured (AC-S20) and
// surfaces a tooltip via the `title` attribute.

"use client";

import type { ManifestEntry } from "@autopus/write-router/types";
import StaleBadge from "./StaleBadge.js";

const INTENT_TRUNCATE = 120;

export type FrameAction = (entry: ManifestEntry) => void;

export interface FrameRowProps {
  entry: ManifestEntry;
  onApply: FrameAction;
  onEdit: FrameAction;
  onSkip: FrameAction;
  onEscalate: FrameAction;
  isApplied: boolean;
  isStale: boolean;
  slackConfigured: boolean;
  manifestValid?: boolean;
}

function confidenceClass(value: number): string {
  if (value >= 0.85) return "confidence-high";
  if (value >= 0.7) return "confidence-mid";
  return "confidence-low";
}

function truncate(text: string, max: number): string {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default function FrameRow({
  entry,
  onApply,
  onEdit,
  onSkip,
  onEscalate,
  isApplied,
  isStale,
  slackConfigured,
  manifestValid = true,
}: FrameRowProps) {
  const intentTruncated = truncate(entry.intent ?? "", INTENT_TRUNCATE);
  const intentNeedsTooltip = (entry.intent ?? "").length > INTENT_TRUNCATE;
  const applyDisabled = isApplied || !manifestValid;
  const escalateDisabled = !slackConfigured;
  const escalateTitle = escalateDisabled
    ? "Slack workspace not configured"
    : "이 프레임을 디자이너에게 에스컬레이션";

  return (
    <article
      className="frame-row"
      data-screen-id={entry.screen_id}
      data-applied={isApplied ? "true" : "false"}
    >
      <header className="frame-row-header">
        <span className="frame-row-screen-id" aria-label="screen id">
          {entry.screen_id}
        </span>
        <h3 className="frame-row-title">{entry.title}</h3>
        {entry.intent_mismatch ? (
          <span
            className="frame-row-intent-mismatch"
            role="status"
            aria-label="intent mismatch"
            title="intent_mismatch reported by generator"
          >
            ▲
          </span>
        ) : null}
        {isStale ? <StaleBadge count={1} /> : null}
      </header>

      <p
        className="frame-row-intent"
        title={intentNeedsTooltip ? entry.intent : undefined}
      >
        {intentTruncated}
      </p>

      <dl className="frame-row-meta">
        <div>
          <dt>confidence</dt>
          <dd className={confidenceClass(entry.confidence)}>
            {entry.confidence.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt>write_target</dt>
          <dd>
            {entry.write_target}
            {entry.write_target === "native_annotation" ? (
              // Native annotations are only visible in Figma Dev Mode (REQ-09, S11).
              <span
                className="native-annotation-hint"
                data-native-hint=""
                title="Native annotations are visible only in Figma Dev Mode"
              >
                Dev Mode only
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="frame-row-actions" role="group" aria-label="frame actions">
        <button
          type="button"
          className="frame-row-action frame-row-apply"
          onClick={() => onApply(entry)}
          disabled={applyDisabled}
          title={
            !manifestValid
              ? "manifest invalid; resolve schema errors first"
              : isApplied
                ? "이미 적용됨"
                : undefined
          }
        >
          Apply
        </button>
        <button
          type="button"
          className="frame-row-action frame-row-edit"
          onClick={() => onEdit(entry)}
        >
          Edit
        </button>
        <button
          type="button"
          className="frame-row-action frame-row-skip"
          onClick={() => onSkip(entry)}
        >
          Skip
        </button>
        <button
          type="button"
          className="frame-row-action frame-row-escalate"
          onClick={() => onEscalate(entry)}
          disabled={escalateDisabled}
          title={escalateTitle}
        >
          Escalate
        </button>
      </div>
    </article>
  );
}
