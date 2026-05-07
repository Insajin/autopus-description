// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S14 (Should).
// Vendor sync runbook subheadings + 5 security audit checklist bullets.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const pinPath = join(
  repoRoot,
  "vendor",
  "cursor-talk-to-figma-mcp",
  "AUTOPUS_PIN.md",
);

describe("AC-S14: vendor sync runbook security checklist (Should)", () => {
  it("AUTOPUS_PIN.md exists and contains the 3 required subheadings", () => {
    expect(existsSync(pinPath)).toBe(true);
    const text = readFileSync(pinPath, "utf8");
    expect(text).toMatch(/^## Monthly Sync Runbook$/m);
    expect(text).toMatch(/^### Step 1: Diff against pinned_commit$/m);
    expect(text).toMatch(/^### Step 2: Security audit checklist$/m);
    expect(text).toMatch(/^### Step 3: Update pinned_commit \+ AUTOPUS_PIN\.md$/m);
  });

  it("security audit checklist contains at least 5 bullets covering the 5 mandated topics", () => {
    const text = readFileSync(pinPath, "utf8");
    const sectionMatch = text.match(
      /### Step 2: Security audit checklist([\s\S]*?)(?=^### |^## |\Z)/m,
    );
    expect(sectionMatch).toBeTruthy();
    const section = sectionMatch![1];
    const bullets = section
      .split("\n")
      .filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"));
    expect(bullets.length).toBeGreaterThanOrEqual(5);

    const blob = section.toLowerCase();
    expect(blob).toMatch(/websocket.*auth|auth.*websocket/);
    expect(blob).toMatch(/postmessage/);
    expect(blob).toMatch(/network.*whitelist|whitelist.*diff/);
    expect(blob).toMatch(/license|attribution/);
    expect(blob).toMatch(/supply.?chain|dep.*diff/);
  });
});
