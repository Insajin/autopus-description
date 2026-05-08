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
