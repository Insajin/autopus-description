#!/usr/bin/env node
// SPEC-FIGMA-011 REQ-08 — post-`tsc` defense: ensure built bins begin with the
// node shebang and are executable. Idempotent: re-running is a no-op when both
// invariants already hold.

import { readFileSync, writeFileSync, statSync, chmodSync, existsSync } from "node:fs";

const SHEBANG = "#!/usr/bin/env node";
const TARGETS = [
  "dist/src/daemon/mcp-stdio-entry.js",
  "dist/src/daemon/mcp-http-entry.js",
  "dist/src/daemon/cli.js",
];

for (const path of TARGETS) {
  if (!existsSync(path)) {
    console.error(`prepend-shebang: missing ${path}`);
    process.exit(1);
  }
  const content = readFileSync(path, "utf8");
  const firstLine = content.split("\n", 1)[0];
  if (firstLine !== SHEBANG) {
    writeFileSync(path, SHEBANG + "\n" + content, "utf8");
    console.log(`prepend-shebang: added shebang to ${path}`);
  }
  const mode = statSync(path).mode;
  // @AX:NOTE: [AUTO] magic constants — `0o111` masks the user/group/other
  // execute bits for the read; `0o755` is rwxr-xr-x granted on chmod.
  if ((mode & 0o111) === 0) {
    chmodSync(path, 0o755);
    console.log(`prepend-shebang: chmod +x ${path}`);
  }
}
