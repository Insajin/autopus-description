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
- Resolved implementation decisions that developers would otherwise ask about:
  default values, submit triggers, page reset, persisted state, refresh cadence,
  navigation surface, permission behavior, and non-goals.
- State-transition rules written as trigger -> UI/data expectation.
- UI and data states: loading, empty, error, disabled, permission denied, and
  populated.
- API, event, parameter, persistence, cache, and analytics contracts.
- Domain terms and abbreviations.
- Non-goals and unresolved questions.

## Output Expectations

Each generated frame entry should explain:

- `intent`: the frame's role in the product flow.
- `user_value`: why the user needs this frame.
- `success_criteria`: observable behavior and feature policy details.
- `states`: UI, data, permission, and error states with trigger and expected
  UI/data effect.
- `edge_cases`: QA branches, implementation risks, permission/error handling,
  stale data, long text/overflow, multi-filter interactions, and unresolved
  decisions marked with `[CANNOT_INFER]`.
- `component_refs`: expected design-system or code component surfaces.
- `data_io`: APIs, inputs, outputs, events, filters, parameters, state, and
  cache behavior.

## Git Policy

- Commit reusable generator code, schemas, tests, docs, and stable project
  context under `.autopus/project/*.md`.
- Do not commit per-project brief answer files, live Figma run manifests,
  screenshot captures, annotation-card ID maps, or client-specific drafts.
- Keep those artifacts under `.autopus/runs/<project-slug>/` or another ignored
  local path, then write the final approved descriptions into Figma.
