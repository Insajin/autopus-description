# validate-manifest

Read-only validator for SPEC-FIGMA-001 frame description manifests. Loads
`schema/frame-description.schema.json` + `schema/description-manifest.schema.json`
(JSON Schema Draft 2020-12, AJV runtime) and emits structured errors to stderr.

## How to run

```bash
cd tools/validate-manifest
npm install
npm run build
node dist/index.js path/to/manifest.json
```

Or against the dogfood sample:

```bash
node tools/validate-manifest/dist/index.js samples/dogfood-30frame.manifest.json
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | manifest passed validation |
| `1` | manifest failed validation (errors emitted as JSON Lines on stderr) |
| `2` | usage error (missing path or unreadable input) |

## stdout / stderr contract

stdout ends with `RESULT pass=N fail=M total=N+M`. On full pass, `pass=frames.length`, `fail=0`. On any failure, `pass=0`, `fail=emitted error count`.

stderr emits one JSON object per line with fields `code`, `json_pointer`, `message` only. Order: schema errors (sorted by JSON Pointer ASCII), then `DUPLICATE_SCREEN_ID` entries. JSON Pointers follow RFC 6901 plain form.

## Error codes

| Code | Trigger |
|------|---------|
| `MISSING_REQUIRED` | required field absent |
| `ENUM_VIOLATION` | value outside allowed enum (e.g. `write_target`) |
| `OUT_OF_RANGE` | numeric value outside `[min, max]` (e.g. `confidence`) |
| `PATTERN_MISMATCH` | string fails declared regex (e.g. `screen_id`, `source_hash`, `pilot_date`) |
| `TYPE_MISMATCH` | type mismatch or unexpected property |
| `DUPLICATE_SCREEN_ID` | two `frames[].screen_id` values collide within a manifest |

## Adding a fixture

1. Place the JSON file under `samples/` or `tools/validate-manifest/test/fixtures/`.
2. Capture the exact stderr JSON Lines and stdout summary as the oracle.
3. Re-run after every schema change to confirm the oracle still matches.

## AC mapping

| Acceptance | Validator surface |
|------------|-------------------|
| AC-S1 | `DUPLICATE_SCREEN_ID` post-pass |
| AC-S2 | `OUT_OF_RANGE` from `confidence` `minimum`/`maximum` |
| AC-S3 | `PATTERN_MISMATCH` for `source_hash` (schema-level) |
| AC-S4 | `ENUM_VIOLATION` for `write_target` |
| AC-S5 | `MISSING_REQUIRED` for any required field |
| AC-S6 | persona_tag parser over field descriptions (consumer side) |
| AC-S7 | producer ordering contract (validator emits no error on sorted input) |
| AC-S8 | derivation contract (consumer side; schema permits both `stale` values) |
| AC-S9 | full pass on `samples/dogfood-30frame.manifest.json` |
| AC-S10 | schema introspection of every field's `description` marker |
| AC-S20 | every stderr record has only `code`, `json_pointer`, `message` |
| AC-S21 | `pilot_metadata.pilot_date` `PATTERN_MISMATCH` on non-ISO-8601 |
| AC-S22 | `--help` exit 0; missing arg exit 2 |

## Reference

- SPEC: `.autopus/specs/SPEC-FIGMA-001/spec.md`
- Acceptance: `.autopus/specs/SPEC-FIGMA-001/acceptance.md`
- Schema source: `schema/frame-description.schema.json`, `schema/description-manifest.schema.json`
