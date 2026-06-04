// Build a one-click MCP Bundle (.mcpb) of the autopus-description MCP server so
// non-developers can install it in Claude Desktop without npm/Node/JSON editing
// (Settings -> Extensions -> Install Extension -> double-click the .mcpb).
//
// Output: dist/autopus-description.mcpb
//
// Requires `npm run build` first (needs dist/). Network is required to install
// production deps into the bundle and to run the mcpb packer — CI handles this;
// locally it needs internet access.

import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const stage = join(repoRoot, "dist", "mcpb");
const outFile = join(repoRoot, "dist", "autopus-description.mcpb");

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const entry = "dist/src/daemon/mcp-stdio-entry.js";
if (!existsSync(join(repoRoot, entry))) {
  console.error(`build-mcpb: ${entry} missing — run \`npm run build\` first.`);
  process.exit(1);
}

// 1) Clean staging dir.
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 2) Copy the compiled server (preserve dist/ layout so entry_point resolves).
for (const sub of ["dist/src", "dist/packages", "dist/types"]) {
  const src = join(repoRoot, sub);
  if (existsSync(src)) cpSync(src, join(stage, sub), { recursive: true });
}
// Runtime reads schema files; ship them alongside.
if (existsSync(join(repoRoot, "schema"))) {
  cpSync(join(repoRoot, "schema"), join(stage, "schema"), { recursive: true });
}

// 3) Minimal package.json so `npm install` pulls only production deps into the
//    bundle (no workspaces, no scripts — avoids prepublish/workspace pitfalls).
const stagedPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: "module",
  dependencies: pkg.dependencies ?? {},
};
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(stagedPkg, null, 2) + "\n",
  "utf8",
);

// 4) Install production deps into the bundle's node_modules.
console.log("build-mcpb: installing production deps into bundle...");
execSync("npm install --omit=dev --no-audit --no-fund --no-package-lock", {
  cwd: stage,
  stdio: "inherit",
});

// 5) MCPB manifest (generated so the version always matches package.json).
const manifest = {
  manifest_version: "0.3",
  name: "autopus-description",
  display_name: "Autopus Description",
  version: pkg.version,
  description:
    "Read Figma frames and write structured design descriptions back via the Autopus Figma plugin. Hosts a local relay on 127.0.0.1:3055; no external network.",
  author: { name: pkg.author ?? "Bitgapnam", url: pkg.homepage },
  homepage: pkg.homepage,
  repository: pkg.repository,
  license: pkg.license ?? "MIT",
  keywords: ["figma", "mcp", "design", "handoff", "description", "autopus"],
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: entry,
    mcp_config: {
      command: "node",
      args: [`\${__dirname}/${entry}`],
      env: {
        // Keep the per-session channel secret + audit outside the install dir.
        AUTOPUS_AUDIT_DIR: "${HOME}/.autopus-figma",
      },
    },
  },
};
writeFileSync(
  join(stage, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);

// 6) Icon (reuse the Community icon when present).
const iconSrc = join(repoRoot, "docs", "assets", "community-icon.png");
if (existsSync(iconSrc)) cpSync(iconSrc, join(stage, "icon.png"));

// 7) Pack into a single .mcpb (zip) via the official packer.
console.log("build-mcpb: packing .mcpb...");
execSync(`npx -y @anthropic-ai/mcpb pack "${stage}" "${outFile}"`, {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`\nbuild-mcpb: ✓ ${outFile}`);
console.log("  Install: Claude Desktop -> Settings -> Extensions -> Install Extension");
