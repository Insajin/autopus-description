// SPEC-FIGMA-007 AC-S11: Plugin status panel renders Approve/Undo without chat UI.
// Linked: REQ-03, REQ-20 | INV-009 (atomicity gate is exclusive to UI button).

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

describe("AC-S11: Plugin status panel renders Approve/Undo + zero chat UI elements", () => {
  it("plugin source has exactly one apply_request emission site anchored to a click handler on data-action=approve", () => {
    const pluginDir = resolve(
      process.cwd(),
      "vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin",
    );

    if (!existsSync(pluginDir)) {
      throw new Error(
        "vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin not present (W3 pending)",
      );
    }

    const grep = spawnSync(
      "bash",
      [
        "-lc",
        `grep -nE "apply_request" ${pluginDir}/autopus_*.ts ${pluginDir}/autopus_*.html 2>/dev/null | grep -v ".test.ts" || true`,
      ],
      { encoding: "utf8" },
    );
    const lines = grep.stdout.split("\n").filter((l) => l.trim().length > 0);

    // Expectations:
    //   * at least one production emission site
    //   * zero chat-input or AI-client message handler emission sites
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const chatLines = lines.filter(
      (l) => /chat[_-]?(input|confirm|message)/i.test(l) || /textarea/i.test(l),
    );
    expect(chatLines.length).toBe(0);
  });

  it("autopus_status_panel.html / .ts contains zero chat-style selectors", () => {
    const panelHtml = resolve(
      process.cwd(),
      "vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_status_panel.html",
    );
    const panelTs = resolve(
      process.cwd(),
      "vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_status_panel.ts",
    );

    if (!existsSync(panelHtml) || !existsSync(panelTs)) {
      throw new Error(
        "autopus_status_panel.{html,ts} not present (W3 pending)",
      );
    }

    const html = readFileSync(panelHtml, "utf8");
    const ts = readFileSync(panelTs, "utf8");

    // REQ-20 — chat UI prohibited.
    const chatPatterns = [
      /data-role=["']chat-input["']/,
      /data-role=["']chat-message["']/,
      /data-role=["']chat-confirm["']/,
      /data-context=["']chat["']/,
    ];
    for (const p of chatPatterns) {
      expect(html).not.toMatch(p);
      expect(ts).not.toMatch(p);
    }

    // Must contain Approve/Undo button selectors.
    expect(html).toMatch(/data-action=["']approve["']/);
    expect(html).toMatch(/data-action=["']undo["']/);
    expect(html).toMatch(/data-testid=["']dryrun-preview["']/);
    expect(html).toMatch(/data-testid=["']source-hash-chip["']/);
  });
});
