# Autopus vendor pin — sonnylazuardi/cursor-talk-to-figma-mcp

pinned_commit: 1c46823f08af9e5da54e78f36b018e95491b33e1
upstream_repo: https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp
pinned_at: 2026-05-07
license: MIT (preserved verbatim — see `LICENSE`)
spec_owner: SPEC-FIGMA-006
distribution: organization private (no Figma Community publish)

## Why this pin exists

SPEC-FIGMA-006 (Autopus MCP Daemon read-only wedge) reuses sonnylazuardi's Figma plugin
shell as a pre-built selection-event surface. Importing the upstream as an npm dependency
is **prohibited** because the upstream does not publish to npm (no releases). Vendoring a
single commit hash gives us:

1. Reproducible builds (no upstream drift mid-Phase-0 dogfood).
2. Local patch surface for status-strip-only UI demotion (no chat UI in our deployment —
   chat goes to the AI client per BS-003 Decision 2).
3. Auditable supply chain: one commit hash to review, one LICENSE to preserve.

This directory MUST NOT appear in `package.json` `dependencies` or `devDependencies`
(AC-S10). It is excluded from the project `tsconfig.json` (`vendor/**`) and marked
`linguist-vendored=true` in `.gitattributes`. It is excluded from the 300-line
per-file rule (file-size-limit.md exclusion: vendored third-party code).

## What is vendored

- `src/talk_to_figma_mcp/` — upstream MCP server reference (kept for parity check; not
  built by our daemon — daemon is Autopus-authored at `[NEW] src/daemon/`).
- `src/cursor_mcp_plugin/` — Figma plugin source (HTML/TS). **Patched locally** to strip
  the chat UI and ship status strip + approve/undo placeholder only (REQ-12). Patch
  delta is recorded in this file's "Local Patches" section below at apply time.
- `LICENSE`, `README.md`, `package.json`, `tsconfig.json`, `tsup.config.ts` — preserved
  for attribution and upstream parity.
- `dist/`, `bun.lock` — kept verbatim for reference; not used by Autopus build.
- `.git/` — **removed** (vendored copy is not a submodule, not a nested repo).

## Monthly Sync Runbook

This runbook is executed once per month (or sooner if a security advisory affects the
pinned commit). It produces an updated `pinned_commit:` entry in this file, a security
audit summary, and a Lore commit.

### Step 1: Diff against pinned_commit

```bash
# Fetch latest upstream into a scratch worktree
git -C /tmp clone https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp scratch-csm \
  || (cd /tmp/scratch-csm && git fetch origin)

# Show every change since our pinned_commit
git -C /tmp/scratch-csm log --stat \
  1c46823f08af9e5da54e78f36b018e95491b33e1..origin/HEAD \
  -- src/cursor_mcp_plugin src/talk_to_figma_mcp

# Get the new commit hash (do NOT advance pinned_commit yet)
git -C /tmp/scratch-csm rev-parse origin/HEAD
```

Record the `pinned_commit → candidate_commit` delta in a temp file
`vendor/cursor-talk-to-figma-mcp/.sync-candidate.md` for review.

### Step 2: Security audit checklist

Before advancing the pin, every item below MUST be verified against the candidate diff
and answered explicitly (PASS / FAIL / N/A) in the sync PR description.

- (a) **WebSocket auth surface review** — diff `src/cursor_mcp_plugin/code.ts` and
  `src/talk_to_figma_mcp/server.ts` for any new connection handler, removed token
  check, or relaxed origin policy. Our daemon binds 127.0.0.1 only and requires a
  per-session token (REQ-14, NFR-03). Any upstream change that broadens this is a
  REJECT signal.
- (b) **postMessage payload validation review** — diff `src/cursor_mcp_plugin/ui.html`
  and `src/cursor_mcp_plugin/code.ts` for new postMessage handlers or removed payload
  checks. Plugin-side `parent.postMessage` payloads are untrusted prompt evidence and
  flow through `wrapUntrustedFigmaText` (REQ-07); a payload-shape change is a
  blocking signal even if the message type is unchanged.
- (c) **Network whitelist diff** — grep candidate for new `fetch(`, `XMLHttpRequest`,
  `WebSocket` host literals, or DNS lookups. Upstream MUST stay within
  `localhost`/`127.0.0.1` for the bridge. Any external host introduction is a REJECT.
- (d) **License / attribution review** — verify `LICENSE` first line still equals
  `The MIT License (MIT)`, copyright holder line still names sonnylazuardi (or
  upstream contributors), no relicense to a non-permissive license has occurred.
  Re-license is a REJECT.
- (e) **Supply-chain dep diff** — diff `package.json` (and `bun.lock`) for new
  runtime deps. Any new dep entering the plugin's runtime path requires manual
  review of that package's publisher reputation, recent release pattern, and
  install scripts. New deps are PASS only if vetted; otherwise REJECT or hold for
  next cycle.

### Step 3: Update pinned_commit + AUTOPUS_PIN.md

Once Step 2's checklist is fully PASS:

```bash
# Hard refresh the vendored copy from the candidate commit
rm -rf vendor/cursor-talk-to-figma-mcp
git clone --depth=1 https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp vendor/cursor-talk-to-figma-mcp
cd vendor/cursor-talk-to-figma-mcp
git checkout <candidate_commit>
rm -rf .git
cd ../..

# Re-apply our local plugin UI patches (status strip / chat UI removal)
# patch apply: see "Local Patches" section below for the canonical patch series

# Update this file
sed -i '' "s/^pinned_commit: .*/pinned_commit: <candidate_commit>/" vendor/cursor-talk-to-figma-mcp/AUTOPUS_PIN.md
sed -i '' "s/^pinned_at: .*/pinned_at: $(date -u +%Y-%m-%d)/" vendor/cursor-talk-to-figma-mcp/AUTOPUS_PIN.md

# Re-run the AC-S10 oracle
npm test -- tests/integration/figma-006/AC-S10.test.ts

# Commit (Lore format)
git add vendor/cursor-talk-to-figma-mcp .sync-candidate.md
git commit -F <(cat <<EOF
chore(vendor): bump cursor-talk-to-figma-mcp pin to <candidate_commit>

<one-line summary of upstream changes>

Constraint: vendor pin advance only after monthly security checklist PASS
Confidence: high
Scope-risk: local
Reversibility: trivial
Directive: revert to 1c46823f08af9e5da54e78f36b018e95491b33e1 if AC-S10 regresses
Tested: AC-S10 oracle (LICENSE first line, AUTOPUS_PIN.md regex, dependencies absence)
Not-tested: live Figma plugin smoke
Related: SPEC-FIGMA-006

🐙 Autopus <noreply@autopus.co>
EOF
)
```

If any Step 2 item is FAIL, do **not** advance the pin. Instead append a
`### REJECTED <date>: <reason>` block under "Sync History" below and revisit next cycle.

## Local Patches

### 2026-05-07 — ui.html status-strip demotion (SPEC-FIGMA-006 REQ-12, BS-003 Decision 2)

Rationale: chat UI lives in the AI client, not the plugin shell; plugin must not
emit external telemetry during Phase 0 dogfood (NFR-04 / NFR-08).

- `src/cursor_mcp_plugin/ui.html`:
  - **Removed**: connection/config/about tabs, port input (`#port`), connect button
    (`#btn-connect`), MCP config block (`#mcp-config`, `#mcp-json`, `#btn-copy`),
    progress bar (`#progress-container`, `#progress-bar`, `#progress-status`,
    `#progress-percentage`), about tab content (`#content-about`), and the entire
    inline GA4 analytics sender (`fetch('https://www.google-analytics.com/...')`,
    measurement/api-secret literals, queue/track/identify functions).
  - **Added**: minimal status strip — connection dot (`#conn-dot`) + label
    (`#conn-label`), `source_hash` chip (`#source-hash-chip`, 8-char prefix),
    `selection_id` chip (`#selection-id-chip`), placeholder buttons
    `#btn-approve` and `#btn-undo` (both `disabled`, labelled
    "(placeholder — SPEC-FIGMA-007)"), and a read-only `window.onmessage` listener
    for `selection-update` / `connection-status` plugin messages.
  - **Line count delta**: 941 → 120 lines (−821).
- `src/cursor_mcp_plugin/code.js`: **unmodified** — upstream parity preserved.
  Listeners that reference removed DOM IDs become no-ops (DOM lookups return null);
  this keeps the monthly sync diff surface clean.
- `src/cursor_mcp_plugin/manifest.json`, `setcharacters.js`: **unmodified**.

## Sync History

- 2026-05-07: initial pin at `1c46823f08af9e5da54e78f36b018e95491b33e1`
  (SPEC-FIGMA-006 baseline; sonnylazuardi v0.x at time of pin).

## File-size-limit exemption

Per `.claude/rules/autopus/file-size-limit.md` exclusion list, the vendored directory
`vendor/cursor-talk-to-figma-mcp/**` is **out-of-scope** for the 300-line hard limit.
This applies to upstream source files only; Autopus-authored patch overlays still fall
under the daemon source rule (≤300 lines per `[NEW] src/daemon/*.ts`).

## Tool Mapping Changes

SPEC-FIGMA-007 REQ-09, REQ-17 — mapping between autopus `WriteTarget` values and the
sonnylazuardi tool names invoked by `autopus_command_dispatch.ts`. When sonnylazuardi
renames a tool upstream, update both this table AND the dispatcher's switch arms in
the same sync PR. The "last verified" column carries the upstream commit hash that
last passed AC-S13 sync drift audit.

| autopus WriteTarget | sonnylazuardi tool name | last verified | notes |
|---------------------|-------------------------|---------------|-------|
| annotation_card     | set_annotation          | 1c46823f      | three sub-commands (create-node / set-text / attach-link) per AC-S8 partial-disconnect oracle |
| descriptions_page   | upsert_descriptions_page_node | 1c46823f | autopus-authored handler — sonnylazuardi has no native equivalent |
| comment             | post_comment            | 1c46823f      | uses figma file REST commentPost; not available via Plugin Bridge |
| plugin_data         | set_plugin_data         | 1c46823f      | key prefix `description_${screen_id}` — matches executor adapter |
| frame_name          | set_frame_name          | 1c46823f      | gated by ALLOW_FRAME_NAME opt-in (REQ-05 of SPEC-FIGMA-004) |
| none                | noop                    | 1c46823f      | broadcast-only path; zero Figma mutation |

## Sync Drift Audit

SPEC-FIGMA-007 REQ-17 monthly checklist. Each item is recorded explicitly (PASS / FAIL /
N/A) in the sync PR description before `pinned_commit` advances. Items (a)–(e) are the
SPEC-FIGMA-006 NFR-07 baseline; item (f) is the SPEC-FIGMA-007 REQ-17 extension.

- (a) **WebSocket auth** — diff `src/cursor_mcp_plugin/code.js` and
  `src/talk_to_figma_mcp/server.ts` for new connection handlers, removed token checks,
  or relaxed origin policy. Daemon binds 127.0.0.1 + per-session token (REQ-14 SPEC-FIGMA-006).
- (b) **postMessage validation** — diff `src/cursor_mcp_plugin/ui.html` and
  `src/cursor_mcp_plugin/code.js` for new postMessage handlers or removed payload checks.
  Plugin payloads are untrusted prompt evidence (REQ-13).
- (c) **Network whitelist** — grep candidate for new `fetch(`, `XMLHttpRequest`,
  `WebSocket` host literals, or DNS lookups. Upstream MUST stay within
  `localhost`/`127.0.0.1`. Any external host introduction is a REJECT.
- (d) **License / attribution** — verify `LICENSE` first line still equals
  `The MIT License (MIT)`, copyright holder still names sonnylazuardi.
- (e) **Supply-chain dep diff** — diff `package.json` (and `bun.lock`) for new runtime
  deps. New deps require manual publisher reputation review.
- (f) **Tool name diff for the 6 mapped tools** (SPEC-FIGMA-007 REQ-17) — for every row
  in the `## Tool Mapping Changes` table above, verify the tool name still exists in
  the upstream `src/talk_to_figma_mcp/server.ts` tool registration. Any rename forces
  the table's "sonnylazuardi tool name" column to record `<old> → <new>` and the
  `autopus_command_dispatch.ts` switch arm to delegate to the new name. The next
  daemon start emits `daemon_vendor_tool_renamed` audit row when this row changes.
