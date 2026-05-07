// SPEC-FIGMA-007 AC-S13: Vendor sync runbook + Tool Mapping Changes table.
// Linked: REQ-17, NFR-04 (vendor pin policy).

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const PIN_PATH = resolve(
  process.cwd(),
  "vendor/cursor-talk-to-figma-mcp/AUTOPUS_PIN.md",
);

describe("AC-S13: AUTOPUS_PIN.md contains Tool Mapping Changes + Sync Drift Audit sections", () => {
  it("file exists at vendor/cursor-talk-to-figma-mcp/AUTOPUS_PIN.md", () => {
    expect(existsSync(PIN_PATH)).toBe(true);
  });

  it("contains a `## Tool Mapping Changes` section with a 4-column table for 6 WriteTarget rows", () => {
    if (!existsSync(PIN_PATH)) {
      throw new Error("AUTOPUS_PIN.md missing (W3 T17 pending)");
    }
    const text = readFileSync(PIN_PATH, "utf8");
    expect(text).toMatch(/^##\s+Tool Mapping Changes\s*$/m);

    // Find the Tool Mapping Changes section body up to the next H2/H1, or end
    // of file if no further section exists. /m + lazy + `$` alternation gave
    // a 0-char match (heading line); use a non-/m match with end-of-string.
    const sectionRegex =
      /##\s+Tool Mapping Changes[\s\S]*?(?=\n##\s|\n#\s[^#]|$)/;
    const match = text.match(sectionRegex);
    expect(match).not.toBeNull();
    const body = match![0];
    // Sanity check — body must include the markdown table.
    expect(body.length).toBeGreaterThan(50);

    // The header row MUST contain the 4 column titles.
    const headerRegex =
      /\|\s*autopus WriteTarget\s*\|\s*sonnylazuardi tool name\s*\|\s*last verified\s*\|\s*notes\s*\|/i;
    expect(body).toMatch(headerRegex);

    // 6 data rows for the 6 WriteTargets.
    const targetRegex =
      /\|\s*(annotation_card|descriptions_page|comment|plugin_data|frame_name|none)\b/g;
    const dataMatches = body.match(targetRegex) ?? [];
    const distinctTargets = new Set(
      dataMatches.map((s) => s.replace(/^\|\s*/, "")),
    );
    expect(distinctTargets.size).toBe(6);
  });

  it("contains `## Sync Drift Audit` section documenting the 6-item monthly checklist", () => {
    if (!existsSync(PIN_PATH)) {
      throw new Error("AUTOPUS_PIN.md missing (W3 T17 pending)");
    }
    const text = readFileSync(PIN_PATH, "utf8");
    expect(text).toMatch(/^##\s+Sync Drift Audit\s*$/m);

    const driftRegex =
      /##\s+Sync Drift Audit[\s\S]*?(?=\n##\s|\n#\s[^#]|$)/;
    const driftBody = (text.match(driftRegex) ?? [""])[0];
    expect(driftBody.length).toBeGreaterThan(50);

    // Must mention the 6 audit items (a)–(f).
    expect(driftBody).toMatch(/WebSocket\s+auth/i);
    expect(driftBody).toMatch(/postMessage\s+validation/i);
    expect(driftBody).toMatch(/network\s+whitelist/i);
    expect(driftBody).toMatch(/license|attribution/i);
    expect(driftBody).toMatch(/supply[\s-]?chain/i);
    expect(driftBody).toMatch(/tool\s+name|tool\s+mapping/i);
  });
});
