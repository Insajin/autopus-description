# Description Brief Flow

This runbook defines the required context-gathering step before generating
Figma frame descriptions.

## Why This Exists

Frame descriptions are not screenshot captions. They must give PMs, designers,
developers, and QA enough context to implement and verify each feature. The
generator therefore needs trusted project context before it turns frame metadata
into a manifest.

## Flow

1. Generate a brief template into a local run-artifact path. Do not commit
   project-specific brief answers for each client/project.

   ```bash
   node dist/src/cli/generate-descriptions.js --init-project-brief=.autopus/runs/<project-slug>/description-brief.json
   ```

2. Ask the stakeholder in the conversation, not inside Figma. Figma should
   receive final descriptions only. Unknown policies should stay empty or move
   to `open_questions`; the generator must not invent them.

3. Run generation with the brief:

   ```bash
   node dist/src/cli/generate-descriptions.js <input-dir> <output-manifest> --project-brief=.autopus/runs/<project-slug>/description-brief.json
   ```

4. In CI or review gates, require the brief:

   ```bash
   node dist/src/cli/generate-descriptions.js <input-dir> <output-manifest> --require-project-brief
   ```

## Required Brief Content

- Product purpose and primary users.
- Core user flows covered by the Figma file.
- Role, permission, and access-control policies.
- Feature-level rules, such as search scope, filter composition, sorting,
  pagination, detail navigation, and reset behavior.
- Interaction rules, such as click, hover, focus, keyboard operation, dropdown
  close, outside click, focus restore, and scroll restoration.
- Motion guidelines, such as side-panel slide, dropdown fade, loading skeleton,
  duration/easing, and reduced-motion behavior.
- Resolved implementation decisions that developers would otherwise ask about:
  default values, submit triggers, page reset, persisted state, refresh cadence,
  navigation surface, permission behavior, and non-goals.
- State-transition rules written as trigger -> UI/data/motion expectation.
- UI and data states: loading, empty, error, disabled, permission denied, and
  populated.
- Data coordination points, event intent, required values, persistence
  expectations, cache/staleness, analytics intent, and permission contracts.
- Domain terms and abbreviations.
- Non-goals and unresolved questions.

## Output Expectations

Each generated frame entry should explain:

- `intent`: the frame's role in the product flow.
- `user_value`: why the user needs this frame.
- `success_criteria`: observable behavior, interaction, motion, and feature
  policy details.
- `states`: UI, data, permission, and error states with trigger and expected
  UI/data/motion effect.
- `edge_cases`: QA branches, implementation risks, permission/error handling,
  stale data, long text/overflow, multi-filter interactions, and unresolved
  decisions marked with `[CANNOT_INFER]`.
- `component_refs`: expected design-system surfaces or product component roles.
  Avoid naming exact code modules unless the project already supplies them.
- `data_io`: data coordination points, required values, events, filters,
  parameters, state, cache/staleness, analytics intent, and permission behavior.

## Figma Description Card Standard

Use `.agents/skills/figma-description/SKILL.md` whenever descriptions are written
back into Figma. The expected Figma surface is not a short caption. It is a
numbered planning description that lets PM, design, development, and QA match a
screen function, state, or interaction target to the detailed rule set.

The badge unit is not a frame. A frame is only the screen container. Add badges
to the functional targets inside the frame: search inputs, dropdowns, filters,
reset buttons, tabs, list rows, pagination, recommendation items, detail-panel
actions, source viewers, download controls, and meaningful state regions.

Required write-back rules:

- Add visible numbered badges inside each target frame near the actual function
  or state target, named `[BADGE] FNN-MM <TARGET_ID>`.
- Do not create exactly one badge per frame unless the frame has exactly one
  meaningful functional target.
- Add the same numbered badge inside the matching badge description block.
- Place cards beside the frame or section, not over the production UI.
- Name the card board `[DESC] <flow name> Cards`.
- Verify by metadata and screenshot that functional badge count and badge
  description block count match.

Required description order:

1. Target and product role.
2. Entry and exposure condition.
3. Default state and fixed values.
4. Input and selection rules, including validation and reset behavior.
5. Button, link, input, dropdown, tab, and toggle interactions.
6. State transitions before and after user action.
7. Exception branches as `Case 1`, `Case 2`, etc.
8. Data, event, cache, refresh, and permission coordination points.
9. QA acceptance checks.

Style rules:

- Follow hierarchy, grouping, numbering, highlighting, and case separation.
- Specify gestures such as click, Enter, Esc, outside click, hover, and focus
  restoration instead of vague phrases like "on select".
- Define link type and landing target: internal link, deep link, external link,
  side panel, modal, same-screen refresh, or document viewer.
- Define hidden UI exposure conditions.
- Define content ordering, min/max count, truncation, fallback, and empty/error
  cases.
- Keep unresolved policies as `[CANNOT_INFER]` or `open_questions`; do not
  invent endpoint names, storage technology, or final business rules.
- Write enough behavior, state, and data coordination detail that an engineer
  can design the product logic. Do not cross into code ownership by inventing
  API endpoint names, database schemas, component names, enum names, libraries,
  or implementation architecture.

## Tone Boundary

- Write enough policy that developers know what behavior to build and QA knows
  what to test.
- Do not cross into implementation ownership by inventing exact endpoint names,
  enum names, code component names, architecture, storage technology, or library
  choices.
- When a technical name is not already supplied, phrase it as a coordination
  point such as "리포트 목록 조회 조건", "상세 열림 이벤트", or "원문 접근 권한 값".

## Git Policy

- Commit reusable generator code, schemas, tests, docs, and stable project
  context under `.autopus/project/*.md`.
- Do not commit per-project brief answer files, live Figma run manifests,
  screenshot captures, annotation-card ID maps, or client-specific drafts.
- Keep those artifacts under `.autopus/runs/<project-slug>/` or another ignored
  local path, then write the final approved descriptions into Figma.
