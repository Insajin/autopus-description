// SPEC-FIGMA-004 W4 — TokenStrip component (REQ-23).
//
// Reads `manifest.pilot_metadata.total_token_cost` and displays a compact
// badge in K-units. Pure presentational; no client interactivity needed.

export interface TokenStripProps {
  totalTokenCost?: number;
  pilotDate?: string;
  reviewerId?: string;
}

function formatTokens(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0K";
  return `${(value / 1000).toFixed(1)}K`;
}

export default function TokenStrip({
  totalTokenCost,
  pilotDate,
  reviewerId,
}: TokenStripProps) {
  return (
    <header className="token-strip" data-testid="token-strip">
      <span className="token-strip-tokens">
        토큰 사용: {formatTokens(totalTokenCost)}
      </span>
      {pilotDate ? (
        <span className="token-strip-meta">파일럿 일자: {pilotDate}</span>
      ) : null}
      {reviewerId ? (
        <span className="token-strip-meta">PM: {reviewerId}</span>
      ) : null}
    </header>
  );
}
