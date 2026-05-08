---
source_of_truth:
  - apps/review-ui/src/components/Dashboard.tsx
  - apps/review-ui/src/components/FrameRow.tsx
  - apps/review-ui/src/components/FrameEditor.tsx
  - apps/review-ui/src/components/TokenStrip.tsx
  - apps/review-ui/src/components/StaleBadge.tsx
  - apps/review-ui/src/components/PersonaView.tsx
---

# DESIGN.md

## Source Of Truth

The Review UI components listed in frontmatter are the current design baseline. There is no separate Figma design system file in this repository yet.

## Visual Theme

The product is a dense PM review dashboard for Figma description manifests. It should feel operational, quiet, and audit-focused: compact lists, clear status markers, low visual noise, and fast scanning over marketing-style presentation.

## Palette Roles

- `background`: neutral page surface for dashboard scanning.
- `foreground`: high-contrast body and frame title text.
- `primary`: apply/save actions and selected review focus.
- `secondary`: edit/cancel and supporting actions.
- `muted`: metadata, token counts, pilot date, reviewer identity, and low-priority labels.
- `danger`: rejected, stale, mismatch, destructive, or escalation states.

## Typography

Use compact dashboard typography. Frame titles should be readable but not hero-sized. Metadata labels, persona fields, token counts, and status chips should use smaller text with enough weight or contrast to remain scannable.

## Component Guardrails

Buttons must expose clear action labels and disabled states. Apply, edit, skip, escalate, save, cancel, and undo flows should remain visually distinct. Inputs and textareas in `FrameEditor` need visible labels, validation feedback, and focus states. Stale and mismatch badges should be noticeable without dominating the row.

## Layout

Optimize for repeated review. Use a constrained main dashboard width, vertical frame rows, compact metadata groups, and action clusters that do not shift layout when status changes. Avoid nested cards and large decorative sections.

## Depth

Prefer simple borders and subtle separation over heavy shadows. Modals or focused editors may use stronger separation, but routine frame rows should stay flat and utilitarian.

## Responsive Behavior

Rows must wrap cleanly on narrow screens. Action buttons should remain reachable without text overlap. Long frame titles, intent text, persona values, hashes, and token numbers must wrap or truncate predictably.

## Do And Don't

- Do preserve the PM review workflow as the first screen.
- Do prioritize scan speed, status clarity, and auditability.
- Do use semantic status treatment for stale, mismatch, pending, applied, and rejected states.
- Don't add landing-page hero sections, decorative gradients, or oversized marketing copy.
- Don't hide write safety, stale state, or validation errors behind purely decorative UI.

## Agent Prompt Guidance

When an AI agent creates, verifies, or reviews UI, use this file with the listed Review UI components as the baseline. Cite the component path used for comparison in findings.
