/**
 * SPEC-FIGMA-008 Phase 1.5 RED scaffold — AC-T14.
 *
 * REQ-14: threat-model.md + opsec-runbook.md content shape oracle.
 * Tests SPEC-008 docs at .autopus/specs/SPEC-FIGMA-008/.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SPEC_DIR = resolve(
  process.cwd(),
  ".autopus/specs/SPEC-FIGMA-008",
);
const THREAT_MODEL = resolve(SPEC_DIR, "threat-model.md");
const OPSEC_RUNBOOK = resolve(SPEC_DIR, "opsec-runbook.md");

const THREAT_HEADINGS = [
  "## T1: Tunnel URL leak",
  "## T2: Bearer reuse across machines",
  "## T3: pluginData plaintext exposure",
  "## T4: cloudflared dependency outage",
  "## T5: MCP method spoofing pre-handshake",
];

const OPSEC_HEADINGS = [
  "## Daily session start",
  "## Token rotation policy",
  "## Revoke flow",
  "## Tunnel adapter swap",
  "## Audit log review checklist",
];

function sliceSection(text: string, heading: string): string {
  // Slice from a line-anchored heading to the next line-anchored "## " heading.
  // Plain text containing the literal "## ..." substring (e.g., backticked prose
  // referencing other headings) MUST NOT confuse the slicer.
  const lines = text.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === heading || lines[i].startsWith(heading)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return "";
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

describe("AC-T14 threat-model + opsec-runbook contain mandatory sections", () => {
  it("Test_ThreatModel_FileExists_ContainsAll5SectionHeadingsInOrder", () => {
    expect(existsSync(THREAT_MODEL)).toBe(true);
    const text = readFileSync(THREAT_MODEL, "utf8");
    let cursor = 0;
    for (const h of THREAT_HEADINGS) {
      const idx = text.indexOf(h, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + h.length;
    }
  });

  it("Test_ThreatModel_EachSectionHasAtLeastOneMitigationSubheading", () => {
    const text = readFileSync(THREAT_MODEL, "utf8");
    for (const h of THREAT_HEADINGS) {
      const section = sliceSection(text, h);
      expect(section).toMatch(/### Mitigation/);
    }
  });

  it("Test_OpsecRunbook_FileExists_ContainsAll5SectionHeadings", () => {
    expect(existsSync(OPSEC_RUNBOOK)).toBe(true);
    const text = readFileSync(OPSEC_RUNBOOK, "utf8");
    for (const h of OPSEC_HEADINGS) {
      expect(text).toContain(h);
    }
  });

  it("Test_OpsecRunbook_TokenRotationPolicy_ContainsTtlAndRotationLiterals", () => {
    const text = readFileSync(OPSEC_RUNBOOK, "utf8");
    const section = sliceSection(text, "## Token rotation policy");
    const hasTtl = section.includes("TTL <= 28800000 ms") || section.includes("8 hours");
    expect(hasTtl).toBe(true);
    expect(section).toContain("TTL-as-rotation");
  });

  it("Test_OpsecRunbook_AuditChecklist_HasAtLeast4MarkdownCheckboxBullets", () => {
    const text = readFileSync(OPSEC_RUNBOOK, "utf8");
    const section = sliceSection(text, "## Audit log review checklist");
    const bullets = section.match(/^- \[ \]/gm) ?? [];
    expect(bullets.length).toBeGreaterThanOrEqual(4);
  });
});
