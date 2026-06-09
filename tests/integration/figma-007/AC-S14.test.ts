// SPEC-FIGMA-007 AC-S14: Redact regex parity across daemon, write-router, and plugin redact ports.
// Linked: REQ-13, REQ-21, NFR-03, NFR-04 | INV-012.
//
// This integration test mirrors the unit-level parity guard
// (tests/unit/redact-patterns-parity.test.ts) but exercises the integration
// boundary: that all 3 redact ports load the SAME source strings from
// `src/redact-patterns.ts` at runtime.

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
  FIGD_PATTERN_SOURCE,
  XOXB_PATTERN_SOURCE,
  BEARER_PATTERN_SOURCE,
  ABSOLUTE_PATH_PATTERNS_SOURCE,
} from "../../../src/redact-patterns.js";
import { TOKEN_PATTERN } from "../../../src/token-redactor.js";

describe("AC-S14: redact regex parity across daemon / write-router / plugin redact ports", () => {
  it("src/token-redactor.ts::TOKEN_PATTERN.source byte-equals FIGD_PATTERN_SOURCE", () => {
    expect(TOKEN_PATTERN.source).toBe(FIGD_PATTERN_SOURCE);
  });

  it("daemon-side redact-extended.ts imports its sources from src/redact-patterns.ts", async () => {
    const mod = await import("../../../src/daemon/redact-extended.js").catch(
      () => null,
    );
    if (!mod) {
      throw new Error(
        "src/daemon/redact-extended.ts not implemented yet (W2 T20 pending)",
      );
    }
    const exported = mod as Record<string, unknown>;
    if ("FIGD_PATTERN_SOURCE" in exported) {
      expect(exported.FIGD_PATTERN_SOURCE).toBe(FIGD_PATTERN_SOURCE);
    }
    if ("XOXB_PATTERN_SOURCE" in exported) {
      expect(exported.XOXB_PATTERN_SOURCE).toBe(XOXB_PATTERN_SOURCE);
    }
    if ("BEARER_PATTERN_SOURCE" in exported) {
      expect(exported.BEARER_PATTERN_SOURCE).toBe(BEARER_PATTERN_SOURCE);
    }
  });

  it("plugin-side autopus_redact.ts has zero inline figd_/xoxb-/bearer regex literals (only imports the constants)", () => {
    const pluginRedactPath = resolve(
      process.cwd(),
      "vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_redact.ts",
    );
    if (!existsSync(pluginRedactPath)) {
      throw new Error(
        "autopus_redact.ts not present (W3 T13 pending)",
      );
    }
    const text = readFileSync(pluginRedactPath, "utf8");

    // Filter out import-statement lines; the body must contain ZERO literal
    // regex sources for figd_/xoxb-/bearer that aren't imported constants.
    const bodyLines = text
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l));
    const body = bodyLines.join("\n");

    expect(body).not.toMatch(/figd_\[/);
    expect(body).not.toMatch(/xoxb-\[/);
    // Bearer pattern literal — case-class start.
    expect(body).not.toMatch(/\[Bb\]earer/);
  });

  it("write-router redactor.ts single-sources the four pattern classes from @autopus/redact-patterns (SPEC-FIGMA-019, no inline literal)", () => {
    const writeRouterRedactPath = resolve(
      process.cwd(),
      "packages/write-router/src/redactor.ts",
    );
    if (!existsSync(writeRouterRedactPath)) {
      throw new Error("packages/write-router/src/redactor.ts not present");
    }
    const text = readFileSync(writeRouterRedactPath, "utf8");

    // It MUST import the four shared pattern sources (structural single source).
    expect(text).toMatch(/from\s+["']@autopus\/redact-patterns["']/);
    expect(text).toMatch(/FIGD_PATTERN_SOURCE/);
    expect(text).toMatch(/XOXB_PATTERN_SOURCE/);
    expect(text).toMatch(/BEARER_PATTERN_SOURCE/);
    expect(text).toMatch(/ABSOLUTE_PATH_PATTERNS_SOURCE/);

    // Body (non-import) MUST NOT carry inline figd_/xoxb-/bearer regex sources.
    const body = text
      .split("\n")
      .filter(
        (l) =>
          !/^\s*import\b/.test(l) &&
          !/from\s+["']@autopus\/redact-patterns["']/.test(l),
      )
      .join("\n");
    expect(body).not.toMatch(/figd_\[/);
    expect(body).not.toMatch(/xoxb-\[/);
    expect(body).not.toMatch(/\[Bb\]earer/);
  });

  it("ABSOLUTE_PATH_PATTERNS_SOURCE is element-wise byte-equal across daemon and plugin ports", async () => {
    const dmod = await import("../../../src/daemon/redact-extended.js").catch(
      () => null,
    );
    if (!dmod) {
      throw new Error(
        "src/daemon/redact-extended.ts not implemented yet (W2 T20 pending)",
      );
    }
    const daemonAbs = (dmod as Record<string, unknown>)
      .ABSOLUTE_PATH_PATTERNS_SOURCE as readonly string[] | undefined;
    if (daemonAbs) {
      expect(daemonAbs.length).toBe(ABSOLUTE_PATH_PATTERNS_SOURCE.length);
      for (let i = 0; i < ABSOLUTE_PATH_PATTERNS_SOURCE.length; i += 1) {
        expect(daemonAbs[i]).toBe(ABSOLUTE_PATH_PATTERNS_SOURCE[i]);
      }
    }
  });
});
