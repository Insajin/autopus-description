# Autopus Description — Figma Community (public) Publish

> Target: public Figma Community listing.
> Plugin name: **Autopus Description** (no "Figma" in the name — Figma brand/publishing guideline).
> Publishing is a manual flow in the Figma desktop app + Figma review. There is no CLI/API for it.

---

## 0. Reviewer-blocking gotchas (read first)

1. **Name must not contain "Figma".** Handled — the build now emits `name: "Autopus Description"` (`scripts/build-figma-plugin.mjs`). Verify in `dist/plugin/manifest.json`.
2. **The plugin does nothing on its own.** It is a thin client to a local daemon (`ws://localhost:3055`) that ships as the npm package `@autopus/figma-mcp`. Without the daemon running + a channel secret pasted in, it cannot connect. The listing description MUST state this up front, and the plugin's empty-state UI now shows a setup hint + repo link so a fresh install does not look broken.
3. **Privacy story is clean — say so.** `networkAccess` is `ws://localhost:3055` only (no external domains), no telemetry/analytics (stripped at build). This is a strong trust signal; state it in the description.

---

## 1. Pre-flight verification

```bash
npm run build            # or: node scripts/build-figma-plugin.mjs
node -p "require('./dist/plugin/manifest.json').name"   # → Autopus Description
```

- `dist/plugin/manifest.json`: `name: "Autopus Description"`, `networkAccess.allowedDomains` = `["ws://localhost:3055"]` only, `permissions: []`, `documentAccess: "dynamic-page"`.
- Dev-mode smoke test: import `dist/plugin/manifest.json`, Run, start the daemon, paste the channel secret, Connect → green dot. Try `get_document_info` / `create_rectangle`.

## 2. Publisher profile (one-time)

- figma.com → your avatar → **Settings → Community profile**. Set handle, display name, avatar, bio. Public plugins are attributed to this profile.

## 3. Editorial assets

| Asset | Spec | Notes |
|-------|------|-------|
| Plugin icon | **128×128 PNG** | Autopus mark (🐙 brand). Solid, legible at small size. |
| Cover art | **1920×960 PNG/JPG** | Plugin name + one-line value. Avoid the word "Figma". |
| Screenshots | optional | A short clip of the Connect → command roundtrip helps. |
| Tagline | ≤ ~80 chars | see below |
| Description | markdown | see below |
| Tags | up to ~12 | see below |
| Categories | pick 1–2 | Productivity, Design Systems |
| Support contact | url/email | repo issues URL |

### Tagline
> Bridge your Figma file to the Autopus MCP daemon so your AI agent can read frames and write design descriptions and edits.

### Description (paste into the Figma publish form)

```markdown
**Autopus Description** connects your Figma file to the Autopus MCP daemon, so an
AI agent (Claude, Codex, and other MCP clients) can read frames and write
structured design descriptions, annotations, and design edits back into Figma.

### ⚠️ Requires a local companion daemon
This plugin is a thin client. It does nothing on its own — you must run the
Autopus MCP daemon locally:

1. `npm i -g @autopus/figma-mcp`
2. Register the `autopus-figma` MCP server in your MCP client (Claude Desktop,
   Claude Code, etc.). The daemon hosts a local relay on `ws://localhost:3055`.
3. On start, the daemon prints a **per-session channel secret** (also written to
   `.autopus/figma-channel.txt`). Paste it into this plugin's field and click
   **Connect**.

Full setup: https://github.com/Insajin/autopus-description

### Privacy & security
- **No external network access.** The plugin talks only to `ws://localhost:3055`
  on your own machine. No data leaves your computer.
- **No telemetry / analytics.**
- The relay binds to a **random per-session secret channel**, so other local
  processes cannot inject commands into your open file.

### Credits
Built on [cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) (MIT).
```

### Tags
`mcp`, `model context protocol`, `ai`, `claude`, `codex`, `design handoff`,
`documentation`, `descriptions`, `automation`, `design to code`, `annotations`

## 4. Publish (Figma desktop)

1. Open any file → **Plugins → Development → Autopus Description → … → Publish new release**.
   (For a first public release, use **Publish**; "Make publicly available" must be **checked**.)
2. Fill the form with the assets above.
3. **Submit for review.** Figma reviews public plugins (typically hours → a few days).
4. On approval the plugin is live on Community. Figma assigns the public plugin id.

## 5. Updates

`npm run build` → Figma desktop → Plugins → Manage → **Publish new release** → version notes → submit.

## 6. Submit checklist

- [ ] `dist/plugin/manifest.json` name = `Autopus Description` (no "Figma")
- [ ] networkAccess = localhost only; no analytics; `permissions: []`
- [ ] Dev-mode smoke test passed (Connect → command roundtrip)
- [ ] Publisher profile set up
- [ ] Icon 128×128 + cover 1920×960 ready
- [ ] Description states the `@autopus/figma-mcp` daemon requirement + setup link
- [ ] Privacy (localhost-only, no telemetry) stated
- [ ] MIT credit to cursor-talk-to-figma-mcp present
- [ ] "Make publicly available" checked → Submit for review

## Notes

- The plugin `id` in `manifest.json` is the dev id; Figma assigns the public id on first publish. Do not hand-edit it.
- Org-private alternative (for internal-only distribution) is documented in `docs/runbooks/figma-org-publish.md`.
