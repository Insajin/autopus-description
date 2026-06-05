# Designer Guide — Working with Figma through Claude Desktop

> **English** · [한국어](designer-figma-mcp-guide.ko.md) · [简体中文](designer-figma-mcp-guide.zh-CN.md) · [日本語](designer-figma-mcp-guide.ja.md)

> Audience: designers fluent in Figma but new to Claude Desktop / MCP
> Environment: **Claude Desktop (Windows)** + Figma desktop app + Autopus Figma plugin
> First-time setup: about 30 minutes

---

## 0. At a glance

Tell Claude Desktop what you want in plain chat, and Claude **works directly on your Figma file** — registering design-system tokens, creating components, fixing auto-layout, drawing flow diagrams. Work you used to do by hand, now driven by natural language.

| What you want | Chat example |
|---------------|--------------|
| Build design-system tokens & components | "Look at tailwind.config.js and build a token/component library" |
| Edit or extend existing work | "Turn the right panel of the Dashboard page into a card grid" |
| Flow diagram / wireframe | "Draw the signup-to-payment flow in FigJam" |
| Build a page/modal from code or a description | "Look at this React code and build the same screen in Figma" |

> Claude Desktop's **official Figma plugin is read-only.** So the "write" actions above are handled by a separate **Autopus Figma plugin** + the **autopus-mcp** server. As a designer, your setup is those two pieces plus registering them in Claude Desktop.

---

## 1. Prerequisites

### 1.1 Install

**Path A — one-click extension (.mcpb) · recommended for non-developers**
No terminal, no Node install, no JSON editing required.

1. Install Claude Desktop: https://claude.ai/download
2. Download **`autopus-description.mcpb`** from GitHub Releases: https://github.com/Insajin/autopus-description/releases/latest
3. Claude Desktop → **Settings → Extensions → (Advanced) Install Extension…** → pick the `.mcpb` you downloaded (or double-click it).
   - Node.js ships inside Claude Desktop, so you don't need to install it separately.
4. Install the Figma desktop app: https://www.figma.com/downloads

**Path B — for developers (npm)**

| Item | How |
|------|-----|
| Node.js 22+ | https://nodejs.org |
| autopus-mcp | `npm install -g @autopus/figma-mcp`, then register it in your MCP client (or use `npx -y @autopus/figma-mcp` in `.mcp.json`) |

### 1.2 Figma token

Figma top-right profile → Settings → Security → Personal access tokens → "Create new token". Enable **Read + File content + Plugin write**. Copy the `figd_...` token and store it somewhere safe.

### 1.3 Install the Autopus Figma plugin

#### Path A — Figma Organization marketplace (after official publish)

1. Figma desktop → top-left hamburger → Resources → Plugins
2. Search "Autopus Figma"
3. Install (Organization-private, so visible only to org accounts)

#### Path B — dev-mode import (before publish, or if you received the zip)

The zip (`autopus-figma-designer.zip`) contains the plugin files. Remember where you unzip it, then:

1. Open **any file** in Figma desktop (an empty file is fine)
2. Top-left hamburger → Plugins → Development → **Import plugin from manifest...**
3. In the file picker, select **`manifest.json`** inside the unzipped folder
4. Afterward Plugins → Development → **Autopus Figma** appears → Run

(A dev-mode plugin registers only on your own account and is not auto-shared with other designers — each person repeats the same import.)

---

## 2. Register autopus-mcp in Claude Desktop

### 2.1 Config file location

On Windows, the `claude_desktop_config.json` path:
```
%APPDATA%\Claude\claude_desktop_config.json
```

Type `%APPDATA%\Claude` into the Explorer address bar to open the folder.

### 2.2 Add the config

Open `claude_desktop_config.json` in Notepad and add this block:

> ⚠️ **Absolute paths are required on Windows.** Claude Desktop often can't find the npm global bin on PATH. Specify `command` as `node` and put the entry script's **absolute path** in `args`.

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

If you already have an `mcpServers` block, just add `"autopus-figma": {...}` inside it.

### 2.3 Restart Claude Desktop

After saving the config, fully quit Claude Desktop (right-click the taskbar tray icon → Quit) and relaunch.

If **autopus-figma** appears under the tools icon below the chat box, registration succeeded.

---

## 3. Before every task — launch the plugin

**Always** do this before issuing commands in chat.

1. Open the file you want to work on in Figma desktop.
2. Top-right hamburger → Plugins → **Autopus Figma** → Run.
3. When the autopus-mcp daemon starts it issues a **channel secret** (random per session). The secret appears in the daemon's stderr log and in the `.autopus/figma-channel.txt` file. You can also ask Claude "tell me the figma channel secret."
4. Paste the secret into the plugin window's input and click **Connect**.
5. When the top dot turns **green + "Connected · channel ok"**, you're ready.

For security, the channel uses a random secret per session (the old fixed `autopus` channel was removed — security audit C-1). Other local processes that don't know the secret cannot join the plugin channel.

When you're done you can close the plugin window. Next time, repeat the same steps.

---

## 4. Four workflows — example prompts

> Every prompt below can be copy-pasted straight into chat. Replace only the `<...>` parts with your values.

### 4.1 Build design-system tokens / components

**prompt**:
```
In the currently open Figma file, build the following design system.
- Color tokens: primary(50/100/.../900), neutral, success, warning, danger
- Spacing tokens: 2, 4, 8, 12, 16, 24, 32, 48
- Fonts: heading(24/20/16), body(14/12)
- Base components: Button(variant: primary/secondary/ghost × size: sm/md/lg), Input, Card
- Register everything as Figma Variables
```

Tools called under the hood: `get_styles` → `create_frame` × N → `set_fill_color` × N → `create_text` × N → `create_component_instance`.

### 4.2 Edit / extend existing design

**prompt**:
```
On the "Dashboard" page of the currently open Figma file, turn the right
side panel into a card grid (3 columns, gap 16, padding 24, auto-layout
vertical, sizing FILL). Keep the text content as is.
```

Tools: `get_selection` → `get_node_info` → `set_layout_mode` → `set_padding` → `set_item_spacing` → `set_layout_sizing`.

### 4.3 Flow diagram / wireframe

**prompt**:
```
Draw the user flow from signup to first completed payment.
- Rectangle nodes: screens (login, identity verification, info entry, payment method, done)
- Diamonds: branches (email verification failed, card failed, coupon applied)
- Connect with arrows
- Flow top to bottom
- Draw it in the currently open Figma file
```

Tools: `create_frame` × N → `create_text` × N → `set_default_connector` → `create_connections`.

### 4.4 Build a page/modal from code or a description

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

Tools: `create_frame` × N → `create_component_instance` (using DS components) → `set_layout_mode` → `set_padding` → `create_text` → `set_fill_color`.

---

## 5. Good to know while working

### 5.1 It pauses to confirm

For big changes (creating a whole file, publishing a library, etc.) Claude asks once for confirmation. **It won't start until you reply** — answer clearly, e.g. "yes, go ahead" or "wait, do the right side first."

### 5.2 Undo works as usual

Every change Claude makes can be undone with Figma's Ctrl+Z.

### 5.3 One thing at a time

Bundling many tasks into one prompt lowers quality. Break big work into steps:

❌ "Make tokens, then build the dashboard with them, then draw the flow too"
✅ Do the three in separate chat sessions or messages

### 5.4 Disconnects

Two cases:

| Situation | Action |
|-----------|--------|
| Plugin window **still open** but connection dropped (dot is red) | Leave it — it **auto-reconnects within 2 seconds**. A WebSocket reconnect loop is running |
| Plugin **window itself closed**, or Claude Desktop was restarted | No auto-recovery. Figma → Plugins → Autopus Figma → **Run** again |

### 5.5 When tools don't show up

If the chat tool list doesn't show things like `create_frame`:
1. Fully quit and relaunch Claude Desktop (tray Quit)
2. Check `claude_desktop_config.json` for syntax errors (commas / brackets)
3. Check that `autopus-mcp-stdio --version` runs in PowerShell — if not, re-run `npm install -g @autopus/figma-mcp`

---

## 6. Joining the description workflow (optional)

Only relevant if a PM builds a manifest and designers join to "review this screen's intent / edge cases." If you only design, you can skip this.

Chat examples:
```
Show me the descriptions the PM published today that relate to frame "Login"
```

```
Show me pending_id "p-abc123" with preview_description, and I'll approve after review
```

approve / undo / preview and friends are autopus-mcp baseline tools, so no extra setup is needed.

---

## 7. Security

- **Never share your Figma token.** It grants access to every file. Don't expose it in Slack, email, or screenshots.
- **Double-check before publishing a library.** Before telling Claude to "publish it," review the result in preview.
- **Review AI output before using it.** Token bindings and auto-layout occasionally come out wrong.
- **No external network calls.** The plugin talks only to `ws://localhost:3055` (the autopus daemon on your own PC). Only localhost is registered in manifest.json `networkAccess.allowedDomains` — external domains like Google Analytics were intentionally removed. Show this file to your security team during review.

---

## 8. FAQ

**Q. Does it work in tools other than Claude Desktop?**
A. Codex CLI, Cursor, etc. work too if they support MCP. This guide assumes Claude Desktop on Windows.

**Q. I entered the wrong token.**
A. Open `%APPDATA%\Claude\claude_desktop_config.json`, replace the `FIGMA_TOKEN` value with a new token, and restart Claude Desktop.

**Q. Who owns the designs the AI makes?**
A. The Figma account owner (= you). Claude only acts on your behalf.

**Q. I asked in Korean but got English labels.**
A. State "all text in Korean" in the prompt.

**Q. What about components that need a library or external font?**
A. The font must already be registered in the Figma file you're using. Claude can't register a new font, so add it in the desktop app beforehand.

---

## 9. Troubleshooting

| Symptom | Action |
|---------|--------|
| autopus-figma missing from Claude Desktop tool list | `claude_desktop_config.json` syntax error + fully restart Claude Desktop |
| `PLUGIN_NOT_CONNECTED` response | Close the Autopus Figma plugin window and Run again. Wait for the top dot to turn green. Still red? Tray Quit Claude Desktop → restart |
| "node_not_found" | Have Claude run `get_selection` or `get_document_info` first to confirm node IDs |
| Font load error | Pre-install/register the font in desktop Figma |
| Colors come out wrong | Figma uses RGBA 0-1 range. Specify units, e.g. "apply #3B82F6 as RGBA 0-1 → r:0.231, g:0.51, b:0.965" |
| Auto-layout breaks | Be explicit, e.g. "set_layout_mode to VERTICAL, set_padding all 16, set_item_spacing 8" |
| Made too much at once | One Ctrl+Z only reverts the last change. Press Ctrl+Z multiple times to undo multiple steps |

If it's still broken, ask in the team channel with a screenshot + error message.

---

## 10. Learn more

- Claude Desktop official docs: https://docs.claude.com/desktop
- Autopus Figma plugin publish procedure (for admins): `docs/runbooks/figma-org-publish.md`
- Source/updates for this guide: team channel or PR
