<div align="center">

<img src="docs/assets/hero-banner.png" alt="Autopus Description — AI エージェントがデザインを読み取り、説明を書きます" width="100%" />

# 🐙 @autopus/figma-mcp

**Figmaフレームを読み取り、監査可能な説明文を書き出す — AIクライアントから直接。**

Autopus Figma **説明ワークフロー** のための [MCP](https://modelcontextprotocol.io) サーバーです。AIクライアント（Claude Code・Codex CLI・Cursor）がFigmaフレームを読み取り、ペルソナタグ付きの説明文を生成し、プロジェクトブリーフを管理し、承認済みの説明アーティファクトをFigmaへ書き戻すことができます — すべてプラグインの明示的な同意のもとで行われます。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@autopus/figma-mcp.svg)](https://www.npmjs.com/package/@autopus/figma-mcp)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF.svg)](https://modelcontextprotocol.io)

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · **日本語**

</div>

---

## これは何ですか？（30秒でわかる概要）

デザイナーが画面を説明する際、そのナレッジはチャットスレッドや古いドキュメントに埋もれてしまいがちです。このパッケージは各Figmaフレームを **構造化・レビュー可能・バージョン管理可能な説明文** に変換します — *その画面の目的・動作・エッジケース* — そして承認された内容をFigmaへ書き戻すことで、ファイルを信頼できる唯一の情報源として保ちます。

> 🧭 **公式Figma MCPのコンパニオンです。** 公式の [`figma`](https://www.figma.com/) MCPサーバーは **デザイン作成** (`use_figma`、`generate_figma_design`、`generate_figma_library`、`generate_diagram`) をカバーします。このパッケージは **説明ワークフロー** — *各フレームが何を意味するか*、そのナレッジを監査可能な方法でFigmaへ書き戻す方法 — をカバーします。両者は補完的ですので、両方インストールしてください。

| あなたのロールは… | 始め方 |
|------------|------------|
| 🎨 **デザイナー**（コード不要） | [デザイナー向け](#-デザイナー向けコード不要) → [完全ガイド](docs/guides/designer-figma-mcp-guide.ja.md) |
| 💻 **開発者** | [インストール](#-インストール開発者向け) → [クイックスタート](#-クイックスタート) |
| 🧑‍💼 **PM / QA** | [説明ワークフロー](#-説明ワークフロー) |

## 🎬 実際の使い方（例）

PMがチェックアウトアプリの **ログイン** 画面をドキュメント化し、エンジニアとQAが画面の正確な動作を把握できるようにするシナリオを想定します。以下は実際にClaude Code（またはCodex / Cursor）へ入力する流れの全体像です。

**1. プロジェクトブリーフを開始する**
> 💬 *「`checkout-app` のプロジェクトブリーフを初期化してください。」*

Claudeが `init_project_brief { project_slug: "checkout-app" }` を実行し、`.autopus/runs/checkout-app/project-brief.json` を作成します。ターゲットユーザー・目標・トーンなどをFigmaの中ではなく、**会話の中で**一緒に記入していきます。

**2. フレームを指定する**
> 💬 *「Figmaファイル `aBcD1234` のフレームを一覧表示してから、ログインフレームのメタデータを見せてください。」*

Claudeが `figma_list_frames { file_id: "aBcD1234" }` → `figma_get_frame_meta` を実行し、フレームの構造・スクリーンショット・ナビゲーション・ソースハッシュを返します。

**3. 説明文を生成する**
> 💬 *「ログインフレームの説明文を生成してください。」*

Claudeが `generate_description { file_id: "aBcD1234", node_id: "12:345" }` を実行し、*保留中* の説明文を返します — この時点ではまだFigmaへの書き込みは行われていません。

```
Frame: Login
Purpose: チェックアウト前に既存ユーザーを認証します。
Behavior: メールアドレス＋パスワードで認証。「パスワードをお忘れですか」でリセットフローへ遷移。
          認証情報が無効な場合はフィールド直下にインラインエラーを表示します。
Edge cases: アカウントロック、セッション期限切れ、SSOフォールバック。
Success: ユーザーが商品を保持したままカートページへ遷移します。
```

**4. PMがレビューする**
> 💬 *「保留中の `p-7f3a` をプレビューしてください。」*

`preview_description { pending_id: "p-7f3a" }` がレビュー用のMarkdownをレンダリングします。必要に応じてPMが文言を調整します。

**5. 承認してFigmaへ書き戻す**
> 💬 *「`p-7f3a` を承認して適用してください。」*

`approve` → `apply { pending_id: "p-7f3a", source_hash_recomputed: "..." }` — この瞬間に初めて、**プラグインの同意ゲートを通じて** 説明文がFigmaファイルへ書き込まれます。デザイナーのフレームに反映された内容が表示されます。

**6. 取り消したい場合は？**
> 💬 *「その書き込みを取り消してください。」*

`undo { write_id: "w-91c2" }` — 1ステップのロールバックです。

> 🔁 **ファイル全体を一括でドキュメント化したい場合は？** ステップ3を `submit_batch_lane { file_id, node_ids: [...] }` に置き換えると、複数フレームの説明文を1回のパスで生成し、まとめてレビュー・承認できます。

➡️ ナレーションなしのツール呼び出しシーケンスだけを確認したい場合は、下記の[説明ワークフロー](#-説明ワークフロー)をご覧ください。

## 目次

- [🎬 実際の使い方（例）](#-実際の使い方例)
- [✨ 主な機能](#-主な機能)
- [🎨 デザイナー向け（コード不要）](#-デザイナー向けコード不要)
- [📦 インストール（開発者向け）](#-インストール開発者向け)
- [🚀 クイックスタート](#-クイックスタート)
- [🧰 MCPツール一覧](#-mcpツール一覧)
- [🔄 説明ワークフロー](#-説明ワークフロー)
- [🏗️ アーキテクチャ](#️-アーキテクチャ)
- [🤝 コンパニオンツール](#-コンパニオンツール)
- [🛠️ 開発](#️-開発)
- [🔒 セキュリティ](#-セキュリティ)
- [📄 ライセンス](#-ライセンス)

## ✨ 主な機能

- **フレームインテリジェンス** — あらゆるフレームからメタデータ・スクリーンショット・ナビゲーション・デザイントークン・ソースハッシュを抽出します。
- **説明文の生成** — モック・Anthropic・OpenAIプロバイダーを使ってペルソナタグ付きの説明文を生成します。
- **PMによるレビュー出力** — プレビュー・編集・承認・適用・取り消しを、完全な監査証跡とともに実施できます。
- **スキーマ担保のマニフェスト** — JSON Schemaと決定的フィクスチャによる検証を行います。
- **2種類のトランスポート** — 長時間稼働のstdioサーバー、またはループバックHTTP/SSEを選択できます。
- **設計段階からセキュア** — シークレットはワイヤーレベルでリダクト、書き込みはプラグインの明示的な同意によりゲートされます。

## 🎨 デザイナー向け（コード不要）

2つのコンポーネント — Figmaプラグインとローカルヘルパーのこのパッケージ — を使います。

1. **Figmaプラグイン** — Figma Communityから **Autopus Description** をインストールします（Figma → プラグイン → 検索）。承認前の開発モードでは `dist/plugin/manifest.json` をインポートすることもできます。
2. **ローカルヘルパー（ワンクリック）** — [最新リリース](https://github.com/Insajin/autopus-description/releases/latest) から `autopus-description.mcpb` をダウンロードし、**Claude Desktop → 設定 → 拡張機能 → 拡張機能をインストール** してください。Node / npm / JSON の知識は不要です — NodeはClaude Desktopに同梱されています。
3. **接続** — Figmaでプラグインを起動し、ヘルパーが表示するチャンネルシークレットを貼り付けて（Claudeに *「figmaのチャンネルシークレットは何？」* と聞いてください）、**接続** をクリックします。

> ℹ️ **どのプラグインを探せばよいですか？** Figmaのプラグイン一覧では **Autopus Description** として表示されます — `@autopus/figma-mcp`（これはnpm / MCPサーバーであり、Figmaプラグインではありません）ではありません。**Cursor MCP Plugin** が表示される場合、またはマニフェストの `allowedDomains` に `google-analytics.com` が含まれている場合は、バンドルされたアップストリームの `vendor/` マニフェストを誤ってインポートしています — それを削除し、`dist/plugin/manifest.json` をインポートし直してください。

📖 **完全ガイド:** [docs/guides/designer-figma-mcp-guide.ja.md](docs/guides/designer-figma-mcp-guide.ja.md)

## 📦 インストール（開発者向け）

```bash
npm install -g @autopus/figma-mcp
```

インストールすると5つのCLIバイナリが追加されます。

| バイナリ | 用途 |
|--------|---------|
| `autopus-mcp-stdio` | Claude / Codex / Cursor向けの長時間稼働MCPサーバー（stdioトランスポート） |
| `autopus-mcp-http` | ループバックHTTP/SSE MCPバリアント |
| `autopus-daemon` | Figmaプラグインブリッジ用のバックグラウンドデーモン |
| `generate-descriptions` | CLIバッチジェネレーター（Figma → 説明マニフェストJSON） |
| `figma-read` | CLI読み取り専用Figmaスナップショットツール |

## 🚀 クイックスタート

### Claude Code

```bash
claude mcp add autopus-figma -- autopus-mcp-stdio
```

または `~/.config/claude/mcp_servers.json` に追加してください。

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

`~/.codex/config.toml` に追加してください。

```toml
[mcp_servers.autopus_figma]
command = "autopus-mcp-stdio"
args = []

[mcp_servers.autopus_figma.env]
FIGMA_TOKEN = "figd_..."
AUTOPUS_AUDIT_DIR = "/Users/<you>/.autopus"
```

> 💡 `FIGMA_TOKEN` はFigmaのパーソナルアクセストークン（`figd_...`）です。**Figma → 設定 → セキュリティ → パーソナルアクセストークン** で作成してください。ファイルへのアクセス権を持つため、厳重に管理してください。

## 🧰 MCPツール一覧

`autopus-mcp-stdio` は4つのティアにわたる最大 **26のツール** を公開します。追加ティアは、起動時に依存関係が接続されている場合のみ有効になります。

| ティア | SPEC | ツール | 常時有効？ |
|------|------|-------|:----------:|
| **ベースライン読み取り** | SPEC-FIGMA-006 / 009 | `get_active_selection`、`get_pending_descriptions`、`get_audit_events`、`get_stale_frames` | ✅ |
| **ベースライン書き込み** | SPEC-FIGMA-011 | `plan_emit`、`dryRun`、`approve`、`apply`、`undo` | writeExtensionが接続されている場合 |
| **Figma読み取り＋検証** | SPEC-FIGMA-014 | `figma_list_frames`、`figma_get_frame_meta`、`figma_export_image`、`figma_get_prototype_graph`、`validate_manifest` | figmaAdapterが接続されている場合 |
| **シングルフレーム生成** | SPEC-FIGMA-014 | `generate_description` | descriptionGeneratorが接続されている場合 |
| **プロジェクトブリーフ** | SPEC-FIGMA-015 | `get_project_brief`、`validate_project_brief`、`init_project_brief`、`update_project_brief` | briefWorkspaceRootが設定されている場合 |
| **オペレーショナル** | SPEC-FIGMA-016 | `get_batch_status`、`get_generation_mode`、`preview_description`、`get_daemon_status`、`submit_batch_lane`、`force_generation_mode` | p2Contextが接続されている場合 |

📋 ツールのListTools順序・不変条件・配線例の詳細は [`docs/runbooks/figma-014-mcp-expansion.md`](docs/runbooks/figma-014-mcp-expansion.md) をご覧ください。

## 🔄 説明ワークフロー

```
init brief → fill brief → validate → inspect frames → generate → preview → approve → apply → undo
```

1. **`init_project_brief { project_slug: "myproj" }`** — `.autopus/runs/myproj/project-brief.json` テンプレートを生成します。
2. ステークホルダー（PM / デザイナー / 開発者 / QA）との会話でブリーフを記入します — Figmaの中ではなく会話で行います。
3. **`validate_project_brief { brief_path }`** — 必須フィールドが揃っているか確認します。
4. **`figma_list_frames { file_id }`** → **`figma_get_frame_meta`** — 対象フレームを確認します。
5. **`submit_batch_lane { file_id, node_ids }`**（複数フレーム）または **`generate_description { file_id, node_id }`**（単一フレーム）を実行します。
6. **`preview_description { pending_id }`** — PMレビュー用のMarkdownビューを表示します。
7. **`approve { pending_id }`** → **`apply { pending_id, source_hash_recomputed }`** — プラグイン経由でFigmaへ書き込みます。
8. **`undo { write_id }`** — 1ステップのロールバックを実行します。

## 🏗️ アーキテクチャ

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

MCPサーバーは **ポリシー / オーサリング境界** です。Figmaプラグインは **同意境界** です — 書き込みはプラグインの明示的な承認（`approve` → `apply`）後にのみ実行されます。トンネルURLとシークレットはMCPワイヤーレベルでリダクトされます（`INV-W2`、`INV-TUNNEL-REDACT`）。

## 🤝 コンパニオンツール

- **公式Figma MCP** — デザイン作成（`use_figma`、`generate_figma_design`、`generate_figma_library`、`generate_diagram`）。デザイナーワークフロー向けに別途インストールしてください。
- **`@autopus/validate-manifest`** — 説明マニフェスト形式のJSON Schemaバリデーター（ワークスペースパッケージ、推移的依存関係として同梱）。

## 🛠️ 開発

```bash
npm install
npm run build       # compiles TypeScript + prepends shebang to bin entries
npm test            # vitest suite
npm run lint        # tsc --noEmit
```

## 🔒 セキュリティ

- すべての送信MCPの `text` ペイロードはトランスポート前に `redact()` を通過します（`INV-W2`）。
- FigmaトークンはEnvironmentから読み取られ、ログに記録されることはありません。
- プロジェクトブリーフのパスは `.autopus/runs/` に制限されます（`INV-BRIEF-PATH`）。
- トンネルURLは `get_daemon_status` でリダクトされます（`INV-TUNNEL-REDACT`）。
- Figma読み取りツールはHTTP GETのみを発行します（`INV-FIGMA-READ`）。

🔐 脆弱性の報告は、このリポジトリの **GitHub Security Advisories** からお願いします。

## 📄 ライセンス

MIT — [LICENSE](LICENSE) をご覧ください。`vendor/` 配下に [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) のMITライセンスコードが含まれています。
