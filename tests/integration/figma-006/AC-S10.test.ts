// SPEC-FIGMA-006 Phase 1.5 RED scaffold — AC-S10.
// sonnylazuardi vendor pin: LICENSE first line "The MIT License (MIT)" (verbatim
// upstream sonnylazuardi LICENSE preservation; corrected 2026-05-07), AUTOPUS_PIN.md
// pinned_commit + upstream_repo lines, no npm dep, tsconfig excludes vendor.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const vendorDir = join(repoRoot, "vendor", "cursor-talk-to-figma-mcp");

describe("AC-S10: sonnylazuardi vendor pin + license preservation", () => {
  it("vendor LICENSE first line equals 'The MIT License (MIT)'", () => {
    const licensePath = join(vendorDir, "LICENSE");
    expect(existsSync(licensePath)).toBe(true);
    const firstLine = readFileSync(licensePath, "utf8").split("\n")[0];
    expect(firstLine).toBe("The MIT License (MIT)");
  });

  it("AUTOPUS_PIN.md contains pinned_commit + upstream_repo + Monthly Sync Runbook heading", () => {
    const pinPath = join(vendorDir, "AUTOPUS_PIN.md");
    expect(existsSync(pinPath)).toBe(true);
    const text = readFileSync(pinPath, "utf8");
    expect(text).toMatch(/^pinned_commit: [0-9a-f]{40}$/m);
    expect(text).toMatch(
      /^upstream_repo: https:\/\/github\.com\/sonnylazuardi\/cursor-talk-to-figma-mcp(\.git)?$/m,
    );
    expect(text).toMatch(/^## Monthly Sync Runbook$/m);
  });

  it("package.json has zero deps containing 'cursor-talk-to-figma-mcp'", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const allKeys = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const matches = allKeys.filter((k) => k.includes("cursor-talk-to-figma-mcp"));
    expect(matches).toEqual([]);
  });

  it("tsconfig.json exclude array contains 'vendor' or 'vendor/**'", () => {
    const tsconfig = JSON.parse(
      readFileSync(join(repoRoot, "tsconfig.json"), "utf8"),
    );
    const excl: string[] = tsconfig.exclude ?? [];
    expect(excl.some((e) => e === "vendor" || e === "vendor/**")).toBe(true);
  });
});
