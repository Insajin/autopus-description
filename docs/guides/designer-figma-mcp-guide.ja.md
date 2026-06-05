# Designer Guide — Claude Desktop から Figma を操作する

> [English](designer-figma-mcp-guide.md) · [한국어](designer-figma-mcp-guide.ko.md) · [简体中文](designer-figma-mcp-guide.zh-CN.md) · **日本語**

> 対象読者: Figma には慣れているが、Claude Desktop / MCP は初めてのデザイナー
> 動作環境: **Claude Desktop (Windows)** + Figma デスクトップアプリ + Autopus Figma プラグイン
> 初回セットアップ所要時間: 約30分

---

## 0. 概要

チャットで伝えるだけで、Claude Desktop が **Figma ファイルを直接操作**してくれます — デザインシステムのトークン登録、コンポーネント作成、オートレイアウトの修正、フロー図の描画など。これまで手作業で行っていた作業を、自然言語で実行できます。

| やりたいこと | チャット例 |
|---|---|
| デザインシステムのトークン＆コンポーネントを作る | "Look at tailwind.config.js and build a token/component library" |
| 既存のデザインを編集・拡張する | "Turn the right panel of the Dashboard page into a card grid" |
| フロー図 / ワイヤーフレームを作る | "Draw the signup-to-payment flow in FigJam" |
| コードや説明からページ・モーダルを作る | "Look at this React code and build the same screen in Figma" |

> Claude Desktop の**公式 Figma プラグインは読み取り専用**です。そのため、上記の「書き込み」操作は、別途用意された **Autopus Figma プラグイン** と **autopus-mcp** サーバーが担います。デザイナーとして必要なセットアップは、この2つのインストールと Claude Desktop への登録だけです。

---

## 1. 事前準備

### 1.1 インストール

**Path A — ワンクリック拡張機能 (.mcpb) · 非開発者向け推奨**
ターミナル不要、Node インストール不要、JSON 編集不要。

1. Claude Desktop をインストール: https://claude.ai/download
2. GitHub Releases から **`autopus-description.mcpb`** をダウンロード: https://github.com/Insajin/autopus-description/releases/latest
3. Claude Desktop → **Settings → Extensions → (Advanced) Install Extension…** → ダウンロードした `.mcpb` を選択（またはダブルクリック）。
   - Node.js は Claude Desktop に同梱されているため、別途インストール不要です。
4. Figma デスクトップアプリをインストール: https://www.figma.com/downloads

**Path B — 開発者向け (npm)**

| 項目 | 方法 |
|------|------|
| Node.js 22以上 | https://nodejs.org |
| autopus-mcp | `npm install -g @autopus/figma-mcp` でインストールし、MCP クライアントに登録（または `.mcp.json` で `npx -y @autopus/figma-mcp` を使用） |

### 1.2 Figma トークンの取得

Figma 右上のプロフィール → Settings → Security → Personal access tokens → "Create new token"。**Read + File content + Plugin write** を有効にしてください。`figd_...` から始まるトークンをコピーして、安全な場所に保管してください。

### 1.3 Autopus Figma プラグインのインストール

#### Path A — Figma Organization マーケットプレイス（正式公開後）

1. Figma デスクトップ → 左上ハンバーガーメニュー → Resources → Plugins
2. "Autopus Figma" を検索
3. インストール（Organization プライベートのため、org アカウントにのみ表示されます）

#### Path B — 開発モードでのインポート（公開前、または zip を受け取った場合）

zip ファイル（`autopus-figma-designer.zip`）にプラグインファイルが含まれています。解凍先のフォルダを覚えておいてから、以下の手順を実行してください。

1. Figma デスクトップで**任意のファイル**を開く（空のファイルでも構いません）
2. 左上ハンバーガーメニュー → Plugins → Development → **Import plugin from manifest...**
3. ファイルピッカーで、解凍したフォルダ内の **`manifest.json`** を選択
4. 完了後、Plugins → Development → **Autopus Figma** が表示されたら → Run をクリック

（開発モードのプラグインは自分のアカウントにのみ登録されます。他のデザイナーには自動共有されないため、各自が同じ手順を繰り返す必要があります。）

---

## 2. Claude Desktop に autopus-mcp を登録する

### 2.1 設定ファイルの場所

Windows では `claude_desktop_config.json` のパスは以下の通りです。
```
%APPDATA%\Claude\claude_desktop_config.json
```

エクスプローラーのアドレスバーに `%APPDATA%\Claude` と入力するとフォルダが開きます。

### 2.2 設定の追加

`claude_desktop_config.json` をメモ帳で開き、以下のブロックを追加してください。

> ⚠️ **Windows では絶対パスが必要です。** Claude Desktop は npm のグローバル bin を PATH から見つけられない場合があります。`command` には `node` を指定し、エントリースクリプトの**絶対パス**を `args` に記述してください。

```json
{
  "mcpServers": {
    "autopus-figma": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_NAME\\AppData\\Roaming\\npm\\node_modules\\@autopus\\figma-mcp\\dist\\src\\daemon\\mcp-stdio-entry.js"
      ],
      "env": {
        "FIGMA_TOKEN": "figd_YOUR_TOKEN_HERE",
        "AUTOPUS_AUDIT_DIR": "%USERPROFILE%\\.autopus"
      }
    }
  }
}
```

すでに `mcpServers` ブロックがある場合は、その中に `"autopus-figma": {...}` を追加するだけで構いません。

### 2.3 Claude Desktop を再起動する

設定を保存したら、Claude Desktop を完全に終了してください（タスクバーのトレイアイコンを右クリック → 終了）し、再起動します。

チャットボックス下のツールアイコンに **autopus-figma** が表示されれば、登録成功です。

---

## 3. 作業前の準備 — プラグインの起動

チャットでコマンドを送る前に、**毎回**この手順を行ってください。

1. Figma デスクトップで操作したいファイルを開きます。
2. 右上ハンバーガーメニュー → Plugins → **Autopus Figma** → Run をクリックします。
3. autopus-mcp デーモンが起動すると、**チャンネルシークレット**（セッションごとにランダムに生成）が発行されます。シークレットはデーモンの stderr ログと `.autopus/figma-channel.txt` ファイルに表示されます。Claude に「tell me the figma channel secret」と聞いて確認することもできます。
4. シークレットをプラグインウィンドウの入力欄に貼り付け、**Connect** をクリックします。
5. 上部のドットが**グリーンになり「Connected · channel ok」**と表示されたら準備完了です。

セキュリティのため、チャンネルはセッションごとにランダムなシークレットを使用します（以前の固定チャンネル `autopus` は廃止されました — セキュリティ監査 C-1）。シークレットを知らないローカルプロセスはプラグインチャンネルに接続できません。

作業が終わったらプラグインウィンドウを閉じて構いません。次回も同じ手順を繰り返してください。

---

## 4. 4つのワークフロー — プロンプト例

> 以下のプロンプトはすべてチャットにそのままコピー&ペーストできます。`<...>` の部分だけ自分の値に置き換えてください。

### 4.1 デザインシステムのトークン / コンポーネントを作成する

**prompt**:
```
In the currently open Figma file, build the following design system.
- Color tokens: primary(50/100/.../900), neutral, success, warning, danger
- Spacing tokens: 2, 4, 8, 12, 16, 24, 32, 48
- Fonts: heading(24/20/16), body(14/12)
- Base components: Button(variant: primary/secondary/ghost × size: sm/md/lg), Input, Card
- Register everything as Figma Variables
```

内部で呼び出されるツール: `get_styles` → `create_frame` × N → `set_fill_color` × N → `create_text` × N → `create_component_instance`。

### 4.2 既存のデザインを編集・拡張する

**prompt**:
```
On the "Dashboard" page of the currently open Figma file, turn the right
side panel into a card grid (3 columns, gap 16, padding 24, auto-layout
vertical, sizing FILL). Keep the text content as is.
```

使用ツール: `get_selection` → `get_node_info` → `set_layout_mode` → `set_padding` → `set_item_spacing` → `set_layout_sizing`。

### 4.3 フロー図 / ワイヤーフレームを作成する

**prompt**:
```
Draw the user flow from signup to first completed payment.
- Rectangle nodes: screens (login, identity verification, info entry, payment method, done)
- Diamonds: branches (email verification failed, card failed, coupon applied)
- Connect with arrows
- Flow top to bottom
- Draw it in the currently open Figma file
```

使用ツール: `create_frame` × N → `create_text` × N → `set_default_connector` → `create_connections`。

### 4.4 コードや説明からページ・モーダルを作成する

**prompt**:
```
Build a "Product detail modal".
- Left: image gallery (1 main + 4 thumbnails in a horizontal stack)
- Right: product name (heading), price (heading), 2 option selectors (Input),
  quantity +/-, add-to-cart button (primary), wishlist icon
- Bottom: 3 tabs (Details / Reviews / Q&A)
- Desktop 1440 width, centered, modal background overlay
- Design system: use the existing "Acme DS" library
```

使用ツール: `create_frame` × N → `create_component_instance`（DS コンポーネントを使用）→ `set_layout_mode` → `set_padding` → `create_text` → `set_fill_color`。

---

## 5. 作業中に知っておくと便利なこと

### 5.1 確認のために一時停止することがある

大きな変更（ファイル全体の作成、ライブラリの公開など）を行う場合、Claude は一度確認を求めます。**返答するまで処理は始まりません** — 「yes, go ahead」や「wait, do the right side first」のように明確に答えてください。

### 5.2 アンドゥは通常通り使える

Claude が加えた変更は、Figma の Ctrl+Z で取り消せます。

### 5.3 一度に一つずつ

多くのタスクを一つのプロンプトにまとめると品質が下がります。大きな作業はステップに分けて行いましょう。

❌ "Make tokens, then build the dashboard with them, then draw the flow too"
✅ 3つを別々のチャットセッションまたはメッセージで行う

### 5.4 接続が切れたとき

2つのケースがあります。

| 状況 | 対処法 |
|------|--------|
| プラグインウィンドウは**開いているが**接続が切れた（ドットが赤い） | そのまま待ってください — **2秒以内に自動再接続**します。WebSocket 再接続ループが動作しています |
| プラグインの**ウィンドウ自体が閉じた**、または Claude Desktop が再起動した | 自動復旧はできません。Figma → Plugins → Autopus Figma → **Run** を再実行してください |

### 5.5 ツールが表示されないとき

チャットのツール一覧に `create_frame` などが表示されない場合:
1. Claude Desktop を完全に終了して再起動する（トレイから終了）
2. `claude_desktop_config.json` の構文エラーを確認する（カンマ / 括弧）
3. PowerShell で `autopus-mcp-stdio --version` が実行できるか確認する — できない場合は `npm install -g @autopus/figma-mcp` を再実行してください

---

## 6. 説明ワークフローへの参加（オプション）

PM がマニフェストを作成し、デザイナーが「この画面の意図 / エッジケースをレビューする」形で参加する場合のみ関係します。デザイン専任の場合はスキップして構いません。

チャット例:
```
Show me the descriptions the PM published today that relate to frame "Login"
```

```
Show me pending_id "p-abc123" with preview_description, and I'll approve after review
```

approve / undo / preview などは autopus-mcp の基本ツールであるため、追加のセットアップは不要です。

---

## 7. セキュリティ

- **Figma トークンは絶対に共有しないでください。** トークンが漏れると、すべてのファイルへのアクセスを許可してしまいます。Slack、メール、スクリーンショットには含めないようにしてください。
- **ライブラリを公開する前に必ず確認してください。** Claude に「publish it」と伝える前に、プレビューで内容を確認してください。
- **AI の出力は使用前にレビューしてください。** トークンのバインディングやオートレイアウトが正しくない場合があります。
- **外部ネットワーク通信はありません。** プラグインは `ws://localhost:3055`（自分の PC 上の autopus デーモン）とのみ通信します。manifest.json の `networkAccess.allowedDomains` には localhost のみが登録されており、Google Analytics などの外部ドメインは意図的に除外されています。セキュリティレビュー時にはこのファイルをセキュリティチームに見せてください。

---

## 8. よくある質問（FAQ）

**Q. Claude Desktop 以外のツールでも使えますか？**
A. Codex CLI、Cursor など、MCP をサポートしていれば動作します。このガイドは Windows の Claude Desktop を前提にしています。

**Q. 誤ったトークンを入力してしまいました。**
A. `%APPDATA%\Claude\claude_desktop_config.json` を開き、`FIGMA_TOKEN` の値を新しいトークンに置き換えて、Claude Desktop を再起動してください。

**Q. AI が作成したデザインの著作権は誰のものですか？**
A. Figma アカウントのオーナー（= あなた）のものです。Claude はあなたの代わりに操作するだけです。

**Q. 日本語で依頼したのに英語のラベルが生成されました。**
A. プロンプトに「all text in Japanese」と明示してください。

**Q. ライブラリや外部フォントが必要なコンポーネントはどうすればいいですか？**
A. フォントはあらかじめ使用する Figma ファイルに登録されている必要があります。Claude は新しいフォントを登録できないため、デスクトップアプリで事前に追加しておいてください。

---

## 9. トラブルシューティング

| 症状 | 対処法 |
|------|--------|
| Claude Desktop のツール一覧に autopus-figma が表示されない | `claude_desktop_config.json` の構文エラーを確認 + Claude Desktop を完全に再起動 |
| `PLUGIN_NOT_CONNECTED` が返される | Autopus Figma プラグインウィンドウを閉じて再度 Run を実行。上部のドットがグリーンになるまで待つ。まだ赤い場合は、トレイから Claude Desktop を終了して再起動 |
| "node_not_found" が表示される | まず Claude に `get_selection` または `get_document_info` を実行させてノード ID を確認してください |
| フォント読み込みエラー | Figma デスクトップでフォントをあらかじめインストール・登録してください |
| 色が正しく出力されない | Figma は RGBA 0〜1 の範囲を使用します。単位を明示してください（例:「#3B82F6 を RGBA 0-1 で適用 → r:0.231, g:0.51, b:0.965」） |
| オートレイアウトが崩れる | 具体的に指定してください（例:「set_layout_mode を VERTICAL に、set_padding を全方向 16 に、set_item_spacing を 8 に」） |
| 一度に作りすぎた | Ctrl+Z 1回では直前の変更のみ取り消せます。複数ステップを取り消すには Ctrl+Z を複数回押してください |

それでも解決しない場合は、スクリーンショットとエラーメッセージをチームチャンネルに投稿して相談してください。

---

## 10. 参考リンク

- Claude Desktop 公式ドキュメント: https://docs.claude.com/desktop
- Autopus Figma プラグイン公開手順（管理者向け）: `docs/runbooks/figma-org-publish.md`
- このガイドのソースと更新情報: チームチャンネルまたは PR
