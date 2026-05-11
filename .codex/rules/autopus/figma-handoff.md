# Figma Handoff Description Rules

IMPORTANT: When writing or rendering Figma frame descriptions for product-to-engineering handoff, the output must stay editable and must not add avoidable visual clutter.

## Visual Annotation Rules

- Do NOT draw connector lines between the source frame and the description document.
- Place numbered badges on the source frame only when they help identify the referenced UI region.
- Also place matching numbered badges inside the description document next to the corresponding region text.
- The description document must be readable without following canvas connector lines.

## Editable Text Rules

- All handoff copy must remain editable Figma `Text` nodes.
- Do NOT flatten description text into vectors, outlines, screenshots, images, or non-editable shapes.
- Prefer separate editable text blocks for title, overview, each numbered region, data requirements, states, and implementation boundary when writing directly to Figma.
- Badge labels may be text nodes inside badge shapes so users can edit the number if the region order changes.

## Content Rules

- Numbered region text must explicitly reference the badge number, for example `배지 1 | 검색/필터 영역`.
- Each numbered region must include product-level behavior, interaction, motion/transition expectation, policy, QA note, and data references when available.
- Keep implementation boundaries clear: describe product behavior and coordination points, but do not prescribe endpoint names, DB tables, enum identifiers, storage technologies, or module names unless supplied by a trusted brief.

## Verification

- Before finishing a Figma write, verify there are zero Autopus connector lines for the run.
- Verify every source-frame badge has a matching document badge.
- Verify all description copy is still represented by editable text nodes.
- Verify no description text is clipped and no document overlaps an existing screen or handoff document.
