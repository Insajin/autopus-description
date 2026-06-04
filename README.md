# @autopus/figma-mcp

MCP server for the Autopus Figma description workflow. Lets AI clients (Claude Code, Codex CLI, Cursor) read Figma frames, generate descriptions, manage project briefs, and write description artifacts back to Figma — all through the Model Context Protocol.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Companion to the official Figma MCP. The official `plugin:figma:figma` server covers design creation (`use_figma`, `generate_figma_design`, `generate_figma_library`, `generate_diagram`). This package covers the **description workflow** — what each frame is for, how it behaves, and how to write that knowledge back to Figma in an auditable way.

## For designers (no code)

Two pieces — a Figma plugin + a local helper (this package):

1. **Figma plugin** — install **Autopus Description** from the Figma Community (Figma → Plugins → search), or import `dist/plugin/manifest.json` in dev-mode before it is approved.
2. **Local helper (one-click)** — download `autopus-description.mcpb` from the [latest release](https://github.com/Insajin/autopus-description/releases/latest), then **Claude Desktop → Settings → Extensions → Install Extension**. No Node/npm/JSON — Node ships with Claude Desktop.
3. **Connect** — run the plugin in Figma, paste the channel secret the helper prints (ask Claude *"what's the figma channel secret?"*), click **Connect**.

Full walkthrough: [docs/guides/designer-figma-mcp-guide.md](docs/guides/designer-figma-mcp-guide.md).

## Install (developers)

```bash
npm install -g @autopus/figma-mcp
```

This installs four CLI binaries:

| Binary | Purpose |
|--------|---------|
| `autopus-mcp-stdio` | Long-running MCP server (stdio transport) for Claude/Codex/Cursor |
| `autopus-mcp-http` | Loopback HTTP/SSE MCP variant |
| `autopus-daemon` | Background daemon for the Figma plugin bridge |
| `generate-descriptions` | CLI batch generator (Figma → description manifest JSON) |
| `figma-read` | CLI read-only Figma snapshot tool |

## Quick start — Claude Code

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

## Quick start — Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.autopus_figma]
command = "autopus-mcp-stdio"
args = []

[mcp_servers.autopus_figma.env]
FIGMA_TOKEN = "figd_..."
AUTOPUS_AUDIT_DIR = "/Users/<you>/.autopus"
```

## MCP tool surface

`autopus-mcp-stdio` exposes up to **26 tools** across 4 tiers. Extra tiers activate only when their dependency is wired at startup.

| Tier | SPEC | Tools | Always on? |
|------|------|-------|------------|
| **Baseline read** | SPEC-FIGMA-006 / 009 | `get_active_selection`, `get_pending_descriptions`, `get_audit_events`, `get_stale_frames` | yes |
| **Baseline write** | SPEC-FIGMA-011 | `plan_emit`, `dryRun`, `approve`, `apply`, `undo` | when writeExtension wired |
| **Figma read + validate** | SPEC-FIGMA-014 | `figma_list_frames`, `figma_get_frame_meta`, `figma_export_image`, `figma_get_prototype_graph`, `validate_manifest` | when figmaAdapter wired |
| **Single-frame generation** | SPEC-FIGMA-014 | `generate_description` | when descriptionGenerator wired |
| **Project brief** | SPEC-FIGMA-015 | `get_project_brief`, `validate_project_brief`, `init_project_brief`, `update_project_brief` | when briefWorkspaceRoot set |
| **Operational** | SPEC-FIGMA-016 | `get_batch_status`, `get_generation_mode`, `preview_description`, `get_daemon_status`, `submit_batch_lane`, `force_generation_mode` | when p2Context wired |

See `docs/runbooks/figma-014-mcp-expansion.md` for the full ListTools ordering, invariants, and wiring example.

## Description workflow

1. **`init_project_brief { project_slug: "myproj" }`** — generates `.autopus/runs/myproj/project-brief.json` template.
2. Fill the brief in conversation with stakeholders (PM/designer/dev/QA) — not inside Figma.
3. **`validate_project_brief { brief_path }`** — confirm required fields present.
4. **`figma_list_frames { file_id }`** then **`figma_get_frame_meta`** — inspect target frames.
5. **`submit_batch_lane { file_id, node_ids }`** (multi-frame) or **`generate_description { file_id, node_id }`** (single).
6. **`preview_description { pending_id }`** — markdown view for PM review.
7. **`approve { pending_id }`** → **`apply { pending_id, source_hash_recomputed }`** — write to Figma through the plugin.
8. **`undo { write_id }`** — single-step rollback.

## Architecture

```
Claude Code / Codex CLI / Cursor
            │ MCP (stdio/http)
            ▼
   autopus-mcp-stdio (this package)
            │ WebSocket
            ▼
   Figma Plugin (autopus_*.ts, MIT-vendored)
            │
            ▼
        Figma file
```

The MCP server is the policy / authoring boundary. The Figma plugin is the consent boundary — writes only happen after explicit plugin approval (`approve` → `apply`). Tunnel URLs and secrets are redacted at the MCP wire (INV-W2, INV-TUNNEL-REDACT).

## Companion tools

- **Official Figma MCP** (`plugin:figma:figma`) — design creation (`use_figma`, `generate_figma_design`, `generate_figma_library`, `generate_diagram`). Install separately for designer workflows.
- **`@autopus/validate-manifest`** — JSON schema validator for the description manifest format (workspace package, shipped as a transitive dependency).

## Development

```bash
npm install
npm run build       # compiles TypeScript + prepends shebang to bin entries
npm test            # vitest suite
npm run lint        # tsc --noEmit
```

## Security

- All outbound MCP `text` payloads pass through `redact()` before transport (INV-W2).
- Figma tokens read from environment, never logged.
- Project brief paths confined to `.autopus/runs/` (INV-BRIEF-PATH).
- Tunnel URLs redacted in `get_daemon_status` (INV-TUNNEL-REDACT).
- Figma read tools emit HTTP GET only (INV-FIGMA-READ).

Report vulnerabilities via GitHub Security Advisories on this repository.

## License

MIT — see [LICENSE](LICENSE). Includes MIT-licensed code from [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) under `vendor/`.
