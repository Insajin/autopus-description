<div align="center">

# 🐙 @autopus/figma-mcp

**Read Figma frames, write auditable descriptions — straight from your AI client.**

An [MCP](https://modelcontextprotocol.io) server for the Autopus Figma **description workflow**. It lets AI clients (Claude Code, Codex CLI, Cursor) read Figma frames, generate persona-tagged descriptions, manage project briefs, and write approved description artifacts back to Figma — all behind explicit plugin consent.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@autopus/figma-mcp.svg)](https://www.npmjs.com/package/@autopus/figma-mcp)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF.svg)](https://modelcontextprotocol.io)

**English** · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

---

## What is this? (30-second version)

Designers describe screens; that knowledge usually gets lost in chat threads and stale docs. This package turns each Figma frame into a **structured, reviewable, version-able description** — *what the screen is for, how it behaves, its edge cases* — and writes the approved result back into Figma so the file stays the source of truth.

> 🧭 **Companion to the official Figma MCP.** The official [`figma`](https://www.figma.com/) MCP server covers **design creation** (`use_figma`, `generate_figma_design`, `generate_figma_library`, `generate_diagram`). This package covers the **description workflow** — *what each frame means* and how to write that knowledge back to Figma in an auditable way. The two are complementary; install both.

| You are a… | Start here |
|------------|------------|
| 🎨 **Designer** (no code) | [For designers](#-for-designers-no-code) → then the [full walkthrough](docs/guides/designer-figma-mcp-guide.md) |
| 💻 **Developer** | [Install](#-install-developers) → [Quick start](#-quick-start) |
| 🧑‍💼 **PM / QA** | [Description workflow](#-description-workflow) |

## 🎬 How it works (example flow)

Say a PM wants to document the **Login** screen of a checkout app so engineers and QA know exactly how it should behave. Here's the whole flow, written the way you'd actually type it into Claude Code (or Codex / Cursor):

**1. Start a project brief**
> 💬 *"Initialize a project brief for `checkout-app`."*

Claude runs `init_project_brief { project_slug: "checkout-app" }` and creates `.autopus/runs/checkout-app/project-brief.json`. You fill it in together — target users, goals, tone — in plain conversation, **not** inside Figma.

**2. Point at the frames**
> 💬 *"List the frames in Figma file `aBcD1234`, then show me the Login frame's metadata."*

Claude runs `figma_list_frames { file_id: "aBcD1234" }` → `figma_get_frame_meta`, returning the frame's structure, screenshot, navigation, and source hash.

**3. Generate a description**
> 💬 *"Generate a description for the Login frame."*

Claude runs `generate_description { file_id: "aBcD1234", node_id: "12:345" }` and returns a *pending* description — nothing is written to Figma yet:

```
Frame: Login
Purpose: Authenticate returning users before checkout.
Behavior: Email + password; "Forgot password" opens the reset flow;
          invalid credentials show an inline error under the field.
Edge cases: locked account, expired session, SSO fallback.
Success: user lands on the cart with items preserved.
```

**4. PM reviews it**
> 💬 *"Preview pending `p-7f3a`."*

`preview_description { pending_id: "p-7f3a" }` renders the markdown for review. The PM tweaks wording if needed.

**5. Approve & write back**
> 💬 *"Approve `p-7f3a` and apply it."*

`approve` → `apply { pending_id: "p-7f3a", source_hash_recomputed: "..." }`. Now — and only now — the description is written into the Figma file **through the plugin's consent gate**. The designer sees it appear on the frame.

**6. Changed your mind?**
> 💬 *"Undo that write."*

`undo { write_id: "w-91c2" }` — single-step rollback.

> 🔁 **Documenting a whole file at once?** Swap step 3 for `submit_batch_lane { file_id, node_ids: [...] }` to generate descriptions for many frames in one pass, then review and approve them together.

➡️ For the bare tool sequence without the narrative, see [Description workflow](#-description-workflow) below.

## Table of contents

- [🎬 How it works (example flow)](#-how-it-works-example-flow)
- [✨ What you get](#-what-you-get)
- [🎨 For designers (no code)](#-for-designers-no-code)
- [📦 Install (developers)](#-install-developers)
- [🚀 Quick start](#-quick-start)
- [🧰 MCP tool surface](#-mcp-tool-surface)
- [🔄 Description workflow](#-description-workflow)
- [🏗️ Architecture](#️-architecture)
- [🤝 Companion tools](#-companion-tools)
- [🛠️ Development](#️-development)
- [🔒 Security](#-security)
- [📄 License](#-license)

## ✨ What you get

- **Frame intelligence** — extract metadata, screenshots, navigation, design tokens, and source hashes from any frame.
- **Description generation** — generate persona-tagged descriptions with mock, Anthropic, or OpenAI providers.
- **PM-reviewable output** — preview, edit, approve, apply, and undo, with a full audit trail.
- **Schema-backed manifests** — validate against JSON Schema and deterministic fixtures.
- **Two transports** — long-running stdio server or loopback HTTP/SSE.
- **Secure by construction** — secrets redacted at the wire, writes gated by explicit plugin consent.

## 🎨 For designers (no code)

Two pieces — a Figma plugin + a local helper (this package):

1. **Figma plugin** — install **Autopus Description** from the Figma Community (Figma → Plugins → search), or import `dist/plugin/manifest.json` in dev-mode before it is approved.
2. **Local helper (one-click)** — download `autopus-description.mcpb` from the [latest release](https://github.com/Insajin/autopus-description/releases/latest), then **Claude Desktop → Settings → Extensions → Install Extension**. No Node / npm / JSON — Node ships with Claude Desktop.
3. **Connect** — run the plugin in Figma, paste the channel secret the helper prints (ask Claude *"what's the figma channel secret?"*), and click **Connect**.

📖 **Full walkthrough:** [docs/guides/designer-figma-mcp-guide.md](docs/guides/designer-figma-mcp-guide.md)

## 📦 Install (developers)

```bash
npm install -g @autopus/figma-mcp
```

This installs five CLI binaries:

| Binary | Purpose |
|--------|---------|
| `autopus-mcp-stdio` | Long-running MCP server (stdio transport) for Claude / Codex / Cursor |
| `autopus-mcp-http` | Loopback HTTP/SSE MCP variant |
| `autopus-daemon` | Background daemon for the Figma plugin bridge |
| `generate-descriptions` | CLI batch generator (Figma → description manifest JSON) |
| `figma-read` | CLI read-only Figma snapshot tool |

## 🚀 Quick start

### Claude Code

```bash
claude mcp add autopus-figma -- autopus-mcp-stdio
```

Or add to `~/.config/claude/mcp_servers.json`:

```json
{
  "autopus-figma": {
    "command": "autopus-mcp-stdio",
    "env": {
      "FIGMA_TOKEN": "figd_...",
      "AUTOPUS_AUDIT_DIR": "~/.autopus"
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.autopus_figma]
command = "autopus-mcp-stdio"
args = []

[mcp_servers.autopus_figma.env]
FIGMA_TOKEN = "figd_..."
AUTOPUS_AUDIT_DIR = "/Users/<you>/.autopus"
```

> 💡 `FIGMA_TOKEN` is your Figma personal access token (`figd_...`). Create one at **Figma → Settings → Security → Personal access tokens**. Keep it secret — it grants file access.

## 🧰 MCP tool surface

`autopus-mcp-stdio` exposes up to **26 tools** across 4 tiers. Extra tiers activate only when their dependency is wired at startup.

| Tier | SPEC | Tools | Always on? |
|------|------|-------|:----------:|
| **Baseline read** | SPEC-FIGMA-006 / 009 | `get_active_selection`, `get_pending_descriptions`, `get_audit_events`, `get_stale_frames` | ✅ |
| **Baseline write** | SPEC-FIGMA-011 | `plan_emit`, `dryRun`, `approve`, `apply`, `undo` | when writeExtension wired |
| **Figma read + validate** | SPEC-FIGMA-014 | `figma_list_frames`, `figma_get_frame_meta`, `figma_export_image`, `figma_get_prototype_graph`, `validate_manifest` | when figmaAdapter wired |
| **Single-frame generation** | SPEC-FIGMA-014 | `generate_description` | when descriptionGenerator wired |
| **Project brief** | SPEC-FIGMA-015 | `get_project_brief`, `validate_project_brief`, `init_project_brief`, `update_project_brief` | when briefWorkspaceRoot set |
| **Operational** | SPEC-FIGMA-016 | `get_batch_status`, `get_generation_mode`, `preview_description`, `get_daemon_status`, `submit_batch_lane`, `force_generation_mode` | when p2Context wired |

📋 See [`docs/runbooks/figma-014-mcp-expansion.md`](docs/runbooks/figma-014-mcp-expansion.md) for the full ListTools ordering, invariants, and a wiring example.

## 🔄 Description workflow

```
init brief → fill brief → validate → inspect frames → generate → preview → approve → apply → undo
```

1. **`init_project_brief { project_slug: "myproj" }`** — generates `.autopus/runs/myproj/project-brief.json` template.
2. Fill the brief in conversation with stakeholders (PM / designer / dev / QA) — not inside Figma.
3. **`validate_project_brief { brief_path }`** — confirm required fields are present.
4. **`figma_list_frames { file_id }`** then **`figma_get_frame_meta`** — inspect target frames.
5. **`submit_batch_lane { file_id, node_ids }`** (multi-frame) or **`generate_description { file_id, node_id }`** (single).
6. **`preview_description { pending_id }`** — markdown view for PM review.
7. **`approve { pending_id }`** → **`apply { pending_id, source_hash_recomputed }`** — write to Figma through the plugin.
8. **`undo { write_id }`** — single-step rollback.

## 🏗️ Architecture

```
Claude Code / Codex CLI / Cursor
            │ MCP (stdio / http)
            ▼
   autopus-mcp-stdio  (this package)   ← policy / authoring boundary
            │ WebSocket
            ▼
   Figma Plugin  (autopus_*.ts, MIT-vendored)   ← consent boundary
            │
            ▼
        Figma file
```

The MCP server is the **policy / authoring boundary**. The Figma plugin is the **consent boundary** — writes happen only after explicit plugin approval (`approve` → `apply`). Tunnel URLs and secrets are redacted at the MCP wire (`INV-W2`, `INV-TUNNEL-REDACT`).

## 🤝 Companion tools

- **Official Figma MCP** — design creation (`use_figma`, `generate_figma_design`, `generate_figma_library`, `generate_diagram`). Install separately for designer workflows.
- **`@autopus/validate-manifest`** — JSON Schema validator for the description manifest format (workspace package, shipped as a transitive dependency).

## 🛠️ Development

```bash
npm install
npm run build       # compiles TypeScript + prepends shebang to bin entries
npm test            # vitest suite
npm run lint        # tsc --noEmit
```

## 🔒 Security

- All outbound MCP `text` payloads pass through `redact()` before transport (`INV-W2`).
- Figma tokens are read from the environment, never logged.
- Project brief paths are confined to `.autopus/runs/` (`INV-BRIEF-PATH`).
- Tunnel URLs are redacted in `get_daemon_status` (`INV-TUNNEL-REDACT`).
- Figma read tools emit HTTP GET only (`INV-FIGMA-READ`).

🔐 Report vulnerabilities via **GitHub Security Advisories** on this repository.

## 📄 License

MIT — see [LICENSE](LICENSE). Includes MIT-licensed code from [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) under `vendor/`.
