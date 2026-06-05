<div align="center">

# 🐙 @autopus/figma-mcp

**直接在 AI 客户端中读取 Figma 框架，生成可审计的设计说明。**

这是一个用于 Autopus Figma **说明工作流**的 [MCP](https://modelcontextprotocol.io) 服务器。它让 AI 客户端（Claude Code、Codex CLI、Cursor）能够读取 Figma 框架、生成带人物标签的说明、管理项目简报，并在获得插件明确授权后将经过审批的说明结果写回 Figma。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@autopus/figma-mcp.svg)](https://www.npmjs.com/package/@autopus/figma-mcp)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF.svg)](https://modelcontextprotocol.io)

[English](README.md) · [한국어](README.ko.md) · **简体中文** · [日本語](README.ja.md)

</div>

---

## 这是什么？（30 秒速览）

设计师描述界面，这些知识通常会淹没在聊天记录和过时文档中。本包将每个 Figma 框架转化为**结构化、可评审、可版本化的说明** — *包括界面用途、交互行为及边界情况* — 并将审批后的结果写回 Figma，使文件始终作为唯一可信来源。

> 🧭 **官方 Figma MCP 的配套工具。** 官方 [`figma`](https://www.figma.com/) MCP 服务器负责**设计创建**（`use_figma`、`generate_figma_design`、`generate_figma_library`、`generate_diagram`）。本包负责**说明工作流** — *每个框架的含义*，以及如何以可审计的方式将这些知识写回 Figma。两者相辅相成，建议同时安装。

| 您的身份… | 从这里开始 |
|------------|------------|
| 🎨 **设计师**（无需编码） | [设计师专区](#-设计师专区无需编码) → 然后查看[完整操作指南](docs/guides/designer-figma-mcp-guide.zh-CN.md) |
| 💻 **开发者** | [安装](#-安装开发者) → [快速开始](#-快速开始) |
| 🧑‍💼 **产品经理 / 测试人员** | [说明工作流](#-说明工作流) |

## 🎬 实际使用流程（示例）

假设一位产品经理需要为某结账应用的**登录**界面编写说明，让工程师和测试人员清楚地了解其预期行为。以下是完整流程，按照您在 Claude Code（或 Codex / Cursor）中实际输入的方式呈现：

**1. 创建项目简报**
> 💬 *"Initialize a project brief for `checkout-app`."*

Claude 执行 `init_project_brief { project_slug: "checkout-app" }` 并创建 `.autopus/runs/checkout-app/project-brief.json`。随后您们通过对话共同填写内容 — 目标用户、产品目标、语气风格 — **无需**在 Figma 内操作。

**2. 定位目标框架**
> 💬 *"List the frames in Figma file `aBcD1234`, then show me the Login frame's metadata."*

Claude 执行 `figma_list_frames { file_id: "aBcD1234" }` → `figma_get_frame_meta`，返回框架的结构、截图、导航关系和源哈希值。

**3. 生成说明**
> 💬 *"Generate a description for the Login frame."*

Claude 执行 `generate_description { file_id: "aBcD1234", node_id: "12:345" }` 并返回一个*待审批*说明 — 此时尚未写入 Figma：

```
Frame: Login
Purpose: 在结账前对回访用户进行身份验证。
Behavior: 邮箱 + 密码；"忘记密码"打开重置流程；
          凭据无效时在字段下方显示内联错误提示。
Edge cases: 账户锁定、会话过期、SSO 回退。
Success: 用户跳转至购物车且商品保持完整。
```

**4. 产品经理评审**
> 💬 *"Preview pending `p-7f3a`."*

`preview_description { pending_id: "p-7f3a" }` 渲染 Markdown 视图供评审。产品经理可按需调整措辞。

**5. 审批并写回**
> 💬 *"Approve `p-7f3a` and apply it."*

`approve` → `apply { pending_id: "p-7f3a", source_hash_recomputed: "..." }`。此时 — 也只有在此时 — 说明才会**通过插件的授权门控**写入 Figma 文件。设计师将看到其出现在框架上。

**6. 反悔了？**
> 💬 *"Undo that write."*

`undo { write_id: "w-91c2" }` — 单步回滚。

> 🔁 **需要一次性为整个文件生成说明？** 将第 3 步替换为 `submit_batch_lane { file_id, node_ids: [...] }`，即可在一次操作中为多个框架生成说明，然后统一评审并审批。

➡️ 如需不含叙述的纯工具调用序列，请参阅下方的[设计说明工作流](#-说明工作流)。

## 目录

- [🎬 实际使用流程（示例）](#-实际使用流程示例)
- [✨ 功能特性](#-功能特性)
- [🎨 设计师专区（无需编码）](#-设计师专区无需编码)
- [📦 安装（开发者）](#-安装开发者)
- [🚀 快速开始](#-快速开始)
- [🧰 MCP 工具接口](#-mcp-工具接口)
- [🔄 说明工作流](#-说明工作流)
- [🏗️ 架构](#️-架构)
- [🤝 配套工具](#-配套工具)
- [🛠️ 开发](#️-开发)
- [🔒 安全](#-安全)
- [📄 许可证](#-许可证)

## ✨ 功能特性

- **框架智能解析** — 从任意框架中提取元数据、截图、导航结构、设计令牌和源哈希值。
- **说明生成** — 使用 mock、Anthropic 或 OpenAI 提供商生成带人物标签的说明。
- **产品经理可评审的输出** — 支持预览、编辑、审批、应用和撤销，并保留完整审计追踪。
- **Schema 驱动的清单** — 基于 JSON Schema 和确定性夹具进行验证。
- **双传输模式** — 支持长连接 stdio 服务器或回环 HTTP/SSE。
- **安全性设计** — 传输层自动脱敏密钥，写操作需经插件明确授权。

## 🎨 设计师专区（无需编码）

仅需两个组件 — 一个 Figma 插件 + 一个本地助手（即本包）：

1. **Figma 插件** — 从 Figma 社区安装 **Autopus Description**（Figma → 插件 → 搜索），或在开发者模式下导入 `dist/plugin/manifest.json`（插件审批通过前可用）。
2. **本地助手（一键安装）** — 从[最新版本](https://github.com/Insajin/autopus-description/releases/latest)下载 `autopus-description.mcpb`，然后 **Claude Desktop → 设置 → 扩展 → 安装扩展**。无需 Node / npm / JSON — Node 已随 Claude Desktop 一起提供。
3. **连接** — 在 Figma 中运行插件，粘贴助手显示的频道密钥（问 Claude *"what's the figma channel secret?"*），然后点击**连接**。

📖 **完整操作指南：** [docs/guides/designer-figma-mcp-guide.zh-CN.md](docs/guides/designer-figma-mcp-guide.zh-CN.md)

## 📦 安装（开发者）

```bash
npm install -g @autopus/figma-mcp
```

安装后将提供五个 CLI 可执行文件：

| 可执行文件 | 用途 |
|--------|---------|
| `autopus-mcp-stdio` | 长连接 MCP 服务器（stdio 传输），适用于 Claude / Codex / Cursor |
| `autopus-mcp-http` | 回环 HTTP/SSE MCP 变体 |
| `autopus-daemon` | Figma 插件桥接的后台守护进程 |
| `generate-descriptions` | CLI 批量生成器（Figma → 说明清单 JSON） |
| `figma-read` | CLI 只读 Figma 快照工具 |

## 🚀 快速开始

### Claude Code

```bash
claude mcp add autopus-figma -- autopus-mcp-stdio
```

或添加到 `~/.config/claude/mcp_servers.json`：

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

添加到 `~/.codex/config.toml`：

```toml
[mcp_servers.autopus_figma]
command = "autopus-mcp-stdio"
args = []

[mcp_servers.autopus_figma.env]
FIGMA_TOKEN = "figd_..."
AUTOPUS_AUDIT_DIR = "/Users/<you>/.autopus"
```

> 💡 `FIGMA_TOKEN` 是您的 Figma 个人访问令牌（`figd_...`）。在 **Figma → 设置 → 安全 → 个人访问令牌** 处创建。请妥善保管 — 它授权访问您的文件。

## 🧰 MCP 工具接口

`autopus-mcp-stdio` 在 4 个层级中最多提供 **26 个工具**。额外层级仅在启动时连接相应依赖后激活。

| 层级 | SPEC | 工具 | 始终启用？ |
|------|------|-------|:----------:|
| **基础读取** | SPEC-FIGMA-006 / 009 | `get_active_selection`、`get_pending_descriptions`、`get_audit_events`、`get_stale_frames` | ✅ |
| **基础写入** | SPEC-FIGMA-011 | `plan_emit`、`dryRun`、`approve`、`apply`、`undo` | 连接 writeExtension 后启用 |
| **Figma 读取 + 验证** | SPEC-FIGMA-014 | `figma_list_frames`、`figma_get_frame_meta`、`figma_export_image`、`figma_get_prototype_graph`、`validate_manifest` | 连接 figmaAdapter 后启用 |
| **单帧生成** | SPEC-FIGMA-014 | `generate_description` | 连接 descriptionGenerator 后启用 |
| **项目简报** | SPEC-FIGMA-015 | `get_project_brief`、`validate_project_brief`、`init_project_brief`、`update_project_brief` | 设置 briefWorkspaceRoot 后启用 |
| **运营管理** | SPEC-FIGMA-016 | `get_batch_status`、`get_generation_mode`、`preview_description`、`get_daemon_status`、`submit_batch_lane`、`force_generation_mode` | 连接 p2Context 后启用 |

📋 完整工具列表、不变量及配置示例请参见 [`docs/runbooks/figma-014-mcp-expansion.md`](docs/runbooks/figma-014-mcp-expansion.md)。

## 🔄 说明工作流

```
初始化简报 → 填写简报 → 验证 → 检查框架 → 生成 → 预览 → 审批 → 应用 → 撤销
```

1. **`init_project_brief { project_slug: "myproj" }`** — 生成 `.autopus/runs/myproj/project-brief.json` 模板。
2. 与相关方（产品经理 / 设计师 / 开发者 / 测试人员）在对话中填写简报 — 不在 Figma 内部操作。
3. **`validate_project_brief { brief_path }`** — 确认必填字段已填写。
4. **`figma_list_frames { file_id }`** 然后 **`figma_get_frame_meta`** — 检查目标框架。
5. **`submit_batch_lane { file_id, node_ids }`**（多帧）或 **`generate_description { file_id, node_id }`**（单帧）。
6. **`preview_description { pending_id }`** — Markdown 视图供产品经理评审。
7. **`approve { pending_id }`** → **`apply { pending_id, source_hash_recomputed }`** — 通过插件写入 Figma。
8. **`undo { write_id }`** — 单步回滚。

## 🏗️ 架构

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

MCP 服务器是**策略 / 创作边界**。Figma 插件是**授权边界** — 只有经过插件明确审批（`approve` → `apply`）后才会执行写操作。隧道 URL 和密钥在 MCP 传输层被脱敏处理（`INV-W2`、`INV-TUNNEL-REDACT`）。

## 🤝 配套工具

- **官方 Figma MCP** — 负责设计创建（`use_figma`、`generate_figma_design`、`generate_figma_library`、`generate_diagram`）。设计师工作流请单独安装。
- **`@autopus/validate-manifest`** — 说明清单格式的 JSON Schema 验证器（工作区包，作为传递依赖项提供）。

## 🛠️ 开发

```bash
npm install
npm run build       # compiles TypeScript + prepends shebang to bin entries
npm test            # vitest suite
npm run lint        # tsc --noEmit
```

## 🔒 安全

- 所有出站 MCP `text` 内容在传输前均通过 `redact()` 处理（`INV-W2`）。
- Figma 令牌从环境变量读取，从不记录日志。
- 项目简报路径限制在 `.autopus/runs/` 目录下（`INV-BRIEF-PATH`）。
- 隧道 URL 在 `get_daemon_status` 中被脱敏（`INV-TUNNEL-REDACT`）。
- Figma 读取工具仅发出 HTTP GET 请求（`INV-FIGMA-READ`）。

🔐 请通过本仓库的 **GitHub Security Advisories** 报告安全漏洞。

## 📄 许可证

MIT — 详见 [LICENSE](LICENSE)。包含来自 [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) 的 MIT 许可代码，位于 `vendor/` 目录下。
