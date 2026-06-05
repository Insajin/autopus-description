# 设计师指南 — 通过 Claude Desktop 操作 Figma

> [English](designer-figma-mcp-guide.md) · [한국어](designer-figma-mcp-guide.ko.md) · **简体中文** · [日本語](designer-figma-mcp-guide.ja.md)

> 适用对象：熟悉 Figma 但初次接触 Claude Desktop / MCP 的设计师
> 环境：**Claude Desktop（Windows）** + Figma 桌面应用 + Autopus Figma 插件
> 首次配置预计耗时：约 30 分钟

---

## 0. 概览

在 Claude Desktop 的对话框中用自然语言告诉 Claude 你想做什么，Claude 便会**直接操作你的 Figma 文件** — 注册设计系统 Token、创建组件、修复自动布局、绘制流程图。以前需要手动完成的工作，现在只需一句话。

| 想做的事 | 对话示例 |
|----------|----------|
| 构建设计系统 Token 与组件 | "查看 tailwind.config.js，构建 Token/组件库" |
| 编辑或扩展现有设计 | "将 Dashboard 页面的右侧面板改为卡片网格" |
| 流程图 / 线框图 | "在 FigJam 中绘制从注册到支付完成的流程" |
| 根据代码或描述构建页面/弹窗 | "查看这段 React 代码，在 Figma 中构建相同的页面" |

> Claude Desktop 的**官方 Figma 插件仅支持只读。** 上述"写入"操作由独立的 **Autopus Figma 插件** + **autopus-mcp** 服务器处理。对于设计师而言，安装这两个组件并在 Claude Desktop 中完成注册即可。

---

## 1. 前置条件

### 1.1 安装

**方式 A — 一键扩展安装（.mcpb）· 推荐给非开发者**
无需终端、无需安装 Node、无需手动编辑 JSON。

1. 安装 Claude Desktop：https://claude.ai/download
2. 从 GitHub Releases 下载 **`autopus-description.mcpb`**：https://github.com/Insajin/autopus-description/releases/latest
3. Claude Desktop → **设置 → 扩展 → （高级）安装扩展…** → 选择刚下载的 `.mcpb` 文件（或直接双击）。
   - Node.js 已内置于 Claude Desktop，无需单独安装。
4. 安装 Figma 桌面应用：https://www.figma.com/downloads

**方式 B — 开发者方式（npm）**

| 项目 | 安装方式 |
|------|----------|
| Node.js 22+ | https://nodejs.org |
| autopus-mcp | `npm install -g @autopus/figma-mcp`，然后在 MCP 客户端中注册（或在 `.mcp.json` 中使用 `npx -y @autopus/figma-mcp`） |

### 1.2 Figma Token

Figma 右上角头像 → 设置 → 安全 → 个人访问 Token → "创建新 Token"。勾选 **Read + File content + Plugin write** 权限。复制 `figd_...` 开头的 Token 并妥善保存。

### 1.3 安装 Autopus Figma 插件

#### 方式 A — Figma 组织市场（官方发布后）

1. Figma 桌面 → 左上角汉堡菜单 → 资源 → 插件
2. 搜索 "Autopus Figma"
3. 安装（组织私有，仅对组织账号可见）

#### 方式 B — 开发模式导入（发布前，或已收到 zip 文件）

zip 压缩包（`autopus-figma-designer.zip`）中包含插件文件。记住解压位置，然后：

1. 在 Figma 桌面中**打开任意文件**（空白文件即可）
2. 左上角汉堡菜单 → 插件 → 开发 → **从 manifest 导入插件...**
3. 在文件选择器中，选择解压文件夹内的 **`manifest.json`**
4. 完成后，插件 → 开发 → **Autopus Figma** 出现 → 运行

（开发模式插件仅注册在你自己的账号下，不会自动共享给其他设计师 — 每人需重复相同的导入步骤。）

---

## 2. 在 Claude Desktop 中注册 autopus-mcp

### 2.1 配置文件位置

Windows 系统中，`claude_desktop_config.json` 的路径为：
```
%APPDATA%\Claude\claude_desktop_config.json
```

在资源管理器地址栏输入 `%APPDATA%\Claude` 可直接打开该文件夹。

### 2.2 添加配置

用记事本打开 `claude_desktop_config.json`，添加以下内容：

> ⚠️ **Windows 上必须使用绝对路径。** Claude Desktop 通常无法从 PATH 中找到 npm 全局 bin 目录。请将 `command` 设为 `node`，并在 `args` 中填写入口脚本的**绝对路径**。

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

如果已有 `mcpServers` 块，直接在其中添加 `"autopus-figma": {...}` 即可。

### 2.3 重启 Claude Desktop

保存配置后，完全退出 Claude Desktop（右键任务栏托盘图标 → 退出），然后重新启动。

如果聊天框下方的工具图标中出现 **autopus-figma**，则表示注册成功。

---

## 3. 每次任务前 — 启动插件

在聊天中发出指令前，**务必**先完成以下步骤。

1. 在 Figma 桌面中打开你要操作的文件。
2. 右上角汉堡菜单 → 插件 → **Autopus Figma** → 运行。
3. autopus-mcp 守护进程启动后会生成一个**频道密钥**（每次会话随机生成）。密钥会显示在守护进程的 stderr 日志和 `.autopus/figma-channel.txt` 文件中。你也可以问 Claude："tell me the figma channel secret"。
4. 将密钥粘贴到插件窗口的输入框中，点击 **Connect**。
5. 顶部圆点变为**绿色且显示 "Connected · channel ok"** 时，即可开始操作。

出于安全考虑，每次会话使用随机密钥（原固定的 `autopus` 频道已移除 — 安全审计 C-1）。不知道密钥的其他本地进程无法接入插件频道。

操作完成后可关闭插件窗口。下次使用时重复相同步骤即可。

---

## 4. 四种工作流 — 示例提示词

> 以下每条提示词均可直接复制到聊天框中使用。仅需将 `<...>` 部分替换为你的实际内容。

### 4.1 构建设计系统 Token / 组件

**prompt**:
```
In the currently open Figma file, build the following design system.
- Color tokens: primary(50/100/.../900), neutral, success, warning, danger
- Spacing tokens: 2, 4, 8, 12, 16, 24, 32, 48
- Fonts: heading(24/20/16), body(14/12)
- Base components: Button(variant: primary/secondary/ghost × size: sm/md/lg), Input, Card
- Register everything as Figma Variables
```

底层调用的工具：`get_styles` → `create_frame` × N → `set_fill_color` × N → `create_text` × N → `create_component_instance`。

### 4.2 编辑 / 扩展现有设计

**prompt**:
```
On the "Dashboard" page of the currently open Figma file, turn the right
side panel into a card grid (3 columns, gap 16, padding 24, auto-layout
vertical, sizing FILL). Keep the text content as is.
```

调用工具：`get_selection` → `get_node_info` → `set_layout_mode` → `set_padding` → `set_item_spacing` → `set_layout_sizing`。

### 4.3 流程图 / 线框图

**prompt**:
```
Draw the user flow from signup to first completed payment.
- Rectangle nodes: screens (login, identity verification, info entry, payment method, done)
- Diamonds: branches (email verification failed, card failed, coupon applied)
- Connect with arrows
- Flow top to bottom
- Draw it in the currently open Figma file
```

调用工具：`create_frame` × N → `create_text` × N → `set_default_connector` → `create_connections`。

### 4.4 根据代码或描述构建页面/弹窗

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

调用工具：`create_frame` × N → `create_component_instance`（使用 DS 组件）→ `set_layout_mode` → `set_padding` → `create_text` → `set_fill_color`。

---

## 5. 操作过程中的注意事项

### 5.1 操作前会暂停确认

对于较大的变更（例如创建整个文件、发布库等），Claude 会提前征询一次确认。**在你回复之前不会开始操作** — 请明确回答，例如 "yes, go ahead" 或 "wait, do the right side first"。

### 5.2 撤销功能正常可用

Claude 的每一步操作均可通过 Figma 的 Ctrl+Z 撤销。

### 5.3 一次只做一件事

在单条提示词中堆砌过多任务会降低质量。建议将大任务拆分为步骤：

❌ "先做 Token，然后用它构建 Dashboard，再画流程图"
✅ 分三次对话或消息分别完成

### 5.4 连接断开

两种情况：

| 情况 | 处理方式 |
|------|----------|
| 插件窗口**仍然打开**但连接断开（圆点变红） | 无需操作 — 插件会**在 2 秒内自动重连**，WebSocket 重连循环正在运行 |
| 插件**窗口已关闭**，或 Claude Desktop 已重启 | 无法自动恢复。Figma → 插件 → Autopus Figma → 重新**运行** |

### 5.5 工具列表中没有显示相应工具

如果聊天工具列表中没有出现 `create_frame` 等工具：
1. 完全退出并重启 Claude Desktop（托盘退出）
2. 检查 `claude_desktop_config.json` 是否有语法错误（逗号/括号）
3. 在 PowerShell 中运行 `autopus-mcp-stdio --version`，若报错请重新执行 `npm install -g @autopus/figma-mcp`

---

## 6. 加入描述工作流（可选）

仅在 PM 发布了 manifest 并邀请设计师"审阅此页面的意图/边界情况"时才需要关注本节。如果你只负责设计，可以跳过。

对话示例：
```
Show me the descriptions the PM published today that relate to frame "Login"
```

```
Show me pending_id "p-abc123" with preview_description, and I'll approve after review
```

approve / undo / preview 等工具均为 autopus-mcp 基础工具，无需额外配置。

---

## 7. 安全须知

- **切勿分享你的 Figma Token。** 它可以访问你的所有文件。请勿在 Slack、邮件或截图中暴露。
- **发布库前请仔细确认。** 告知 Claude "发布"之前，先在预览中审查结果。
- **使用前请审查 AI 输出。** Token 绑定和自动布局偶尔会出错。
- **无外部网络请求。** 插件仅与 `ws://localhost:3055`（本机的 autopus 守护进程）通信。manifest.json 的 `networkAccess.allowedDomains` 中仅注册了 localhost — Google Analytics 等外部域名已被有意移除。安全审查时可将此文件提供给安全团队查阅。

---

## 8. 常见问题

**Q. 能在 Claude Desktop 以外的工具中使用吗？**
A. 支持 MCP 的 Codex CLI、Cursor 等工具同样适用。本指南以 Windows 上的 Claude Desktop 为例。

**Q. 输入了错误的 Token 怎么办？**
A. 打开 `%APPDATA%\Claude\claude_desktop_config.json`，将 `FIGMA_TOKEN` 的值替换为新 Token，然后重启 Claude Desktop。

**Q. AI 生成的设计归谁所有？**
A. 归 Figma 账号所有者（即你）。Claude 仅代表你执行操作。

**Q. 我用韩语提问，但生成的标签是英文。**
A. 在提示词中注明"all text in Korean"即可。

**Q. 需要用到某个库中的组件或外部字体怎么办？**
A. 字体必须事先在你使用的 Figma 文件中完成注册。Claude 无法注册新字体，请提前在桌面应用中添加。

---

## 9. 故障排查

| 症状 | 处理方式 |
|------|----------|
| Claude Desktop 工具列表中缺少 autopus-figma | `claude_desktop_config.json` 语法错误 + 完全重启 Claude Desktop |
| 收到 `PLUGIN_NOT_CONNECTED` 响应 | 关闭 Autopus Figma 插件窗口后重新运行，等待顶部圆点变绿。仍为红色？托盘退出 Claude Desktop → 重启 |
| "node_not_found" | 让 Claude 先运行 `get_selection` 或 `get_document_info` 以确认节点 ID |
| 字体加载报错 | 提前在 Figma 桌面应用中安装/注册该字体 |
| 颜色显示不正确 | Figma 使用 RGBA 0-1 范围。请明确指定单位，例如"将 #3B82F6 转为 RGBA 0-1 → r:0.231, g:0.51, b:0.965" |
| 自动布局异常 | 请明确说明，例如"set_layout_mode to VERTICAL, set_padding all 16, set_item_spacing 8" |
| 一次性生成了太多内容 | 一次 Ctrl+Z 仅撤销最后一步。多次按 Ctrl+Z 可逐步撤销 |

如问题仍未解决，请在团队频道中附上截图和错误信息进行反馈。

---

## 10. 延伸阅读

- Claude Desktop 官方文档：https://docs.claude.com/desktop
- Autopus Figma 插件发布流程（管理员）：`docs/runbooks/figma-org-publish.md`
- 本指南的源文件/更新：团队频道或 PR
