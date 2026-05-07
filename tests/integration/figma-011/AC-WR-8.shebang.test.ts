// SPEC-FIGMA-011 T15 / AC-WR-8 — Phase 1.5 RED scaffold.
// Built bins begin with shebang, have execute bit, and run without ENOEXEC.
// Depends on `npm run build` having produced dist files. If dist is missing,
// the spec describes building it; for RED we mark the spawn-test pending.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..");
const BIN_STDIO = resolve(ROOT, "dist", "src", "daemon", "mcp-stdio-entry.js");
const BIN_DAEMON = resolve(ROOT, "dist", "src", "daemon", "cli.js");
const SHEBANG = "#!/usr/bin/env node";

function distExists(): boolean {
  return existsSync(BIN_STDIO) && existsSync(BIN_DAEMON);
}

describe("AC-WR-8: built bins begin with shebang and have execute bit", () => {
  it("dist/src/daemon/mcp-stdio-entry.js line 1 byte-equals shebang and has execute bit", () => {
    expect(distExists()).toBe(true);
    const content = readFileSync(BIN_STDIO, "utf8");
    const line1 = content.split("\n")[0];
    expect(line1).toBe(SHEBANG);
    const mode = statSync(BIN_STDIO).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it("dist/src/daemon/cli.js line 1 byte-equals shebang and has execute bit", () => {
    expect(distExists()).toBe(true);
    const content = readFileSync(BIN_DAEMON, "utf8");
    const line1 = content.split("\n")[0];
    expect(line1).toBe(SHEBANG);
    const mode = statSync(BIN_DAEMON).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it("spawnSync of dist mcp-stdio-entry returns no ENOEXEC and produces valid JSON-RPC initialize result", () => {
    expect(distExists()).toBe(true);
    const initRequest =
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.0"}}}\n';
    const result = spawnSync(BIN_STDIO, [], {
      input: initRequest,
      timeout: 5_000,
      encoding: "utf8",
    });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      expect(code).not.toBe("ENOEXEC");
    }
    const stdout = result.stdout ?? "";
    const lines = stdout.split("\n").filter(Boolean);
    let foundServerInfo = false;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          id?: number;
          result?: { serverInfo?: { name?: string } };
        };
        if (parsed.id === 1 && parsed.result?.serverInfo?.name === "autopus-mcp-stdio") {
          foundServerInfo = true;
          break;
        }
      } catch {
        // skip non-JSON line
      }
    }
    expect(foundServerInfo).toBe(true);
  });
});
