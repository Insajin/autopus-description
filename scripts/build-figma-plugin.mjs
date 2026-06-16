#!/usr/bin/env node
// SPEC-FIGMA-017 — Build the "Autopus Figma" Figma plugin from vendor + autopus
// description handlers. Vendor `code.js` is preserved verbatim so future
// `git subtree pull` works (REQ-07). Local additions are appended (handle
// description commands) and `manifest.json` is rebranded.
//
// Output: dist/plugin/{code.js, ui.html, manifest.json}
//
// Run as part of `npm run build` (added to package.json scripts).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const vendorPluginDir = join(
  repoRoot,
  "vendor",
  "cursor-talk-to-figma-mcp",
  "src",
  "cursor_mcp_plugin",
);
const outDir = join(repoRoot, "dist", "plugin");

mkdirSync(outDir, { recursive: true });

// 1) Manifest rebrand
const manifestSrc = JSON.parse(
  readFileSync(join(vendorPluginDir, "manifest.json"), "utf8"),
);
// SPEC-FIGMA-017 — the autopus ui.html demotes upstream analytics and never
// fetches google-analytics.com. Strip that host from networkAccess so the
// manifest policy matches actual runtime behaviour (avoids security-team
// confusion). Keep only the local relay socket.
const stripGoogleAnalytics = (domains) =>
  (domains || []).filter((d) => !/google-analytics\.com/i.test(d));

const rebranded = {
  ...manifestSrc,
  // Public Community name must not contain "Figma" (Figma brand/publishing
  // guideline). "Autopus Description" — the design-description workflow plugin.
  name: "Autopus Description",
  // The vendor manifest id (1485687494525374295) is the UPSTREAM "Talk To Figma
  // MCP Plugin" that is already LIVE on Figma Community — publishing under it is
  // impossible. Pin our own Community plugin id (created under the publishing
  // account) so dev-mode import matches the plugin we publish.
  id: "1644170376077943662",
  networkAccess: {
    ...manifestSrc.networkAccess,
    allowedDomains: stripGoogleAnalytics(manifestSrc.networkAccess?.allowedDomains),
    devAllowedDomains: stripGoogleAnalytics(
      manifestSrc.networkAccess?.devAllowedDomains,
    ),
    reasoning:
      "Connects to a local Autopus relay (autopus daemon ws://127.0.0.1:3055). No external network access.",
  },
};
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(rebranded, null, 2) + "\n",
  "utf8",
);
console.log(`build-figma-plugin: manifest.json (name="${rebranded.name}")`);

// 2) Plugin main thread — vendor verbatim + autopus description handler patch.
let vendorCodeJs = readFileSync(join(vendorPluginDir, "code.js"), "utf8");

// H-3: Strip vendor analytics IIFE from the built output (telemetry transparency).
// The vendor source is NOT modified — only the in-memory copy used for the build.
// If the block shifts in a future vendor update, emit a warning and continue with
// the original content (defensive — never break the build over a missing strip).
// Pattern is conservative and specific: matches the comment + IIFE verbatim.
// Uses [\r\n]+ to handle both LF and CRLF line endings in vendor source.
const ANALYTICS_BLOCK =
  /\/\/ Initialize anonymous analytics client_id \(persisted via clientStorage\)[\r\n]+\(async \(\) => \{[\s\S]*?analyticsClientId[\s\S]*?\}\)\(\);[\r\n]+/;
const strippedCodeJs = vendorCodeJs.replace(ANALYTICS_BLOCK, "");
if (strippedCodeJs === vendorCodeJs) {
  console.warn(
    "build-figma-plugin: analytics block not found — vendor code.js may have changed",
  );
} else {
  vendorCodeJs = strippedCodeJs;
  console.log("build-figma-plugin: analytics IIFE stripped (H-3)");
}

// SPEC-FIGMA-021 — bundle the canonical dispatcher (autopus_command_dispatch.ts
// + its import graph: the two renderers, autopus_redact.ts, src/redact-patterns.ts,
// and the bare specifier @autopus/redact-patterns) into ONE IIFE with global name
// AutopusDispatch. This integrates the unit-tested dispatcher into the shipped
// plugin as the single source of truth (REQ-03) rather than duplicating render
// logic in the patch switch.
//
// esbuild does NOT auto-rewrite the `.js` extensions in relative imports back to
// the real `.ts` source files, so a resolve plugin maps `./foo.js` → `./foo.ts`
// when that .ts exists. Bare specifiers (@autopus/redact-patterns) fall through to
// default node resolution (its package.json main points at ./src/index.ts).
const tsJsResolve = {
  name: "ts-js-resolve",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === "entry-point" || !args.importer) return;
      if (!args.path.startsWith(".")) return; // bare specifiers → default resolution
      const candidate = resolve(dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      if (existsSync(candidate)) return { path: candidate };
      return; // fall through to default (real .js)
    });
  },
};
const bundle = await esbuild.build({
  entryPoints: [join(vendorPluginDir, "autopus_command_dispatch.ts")],
  bundle: true,
  format: "iife",
  globalName: "AutopusDispatch",
  platform: "browser",
  target: "es2017",
  write: false,
  legalComments: "none",
  plugins: [tsJsResolve],
});
const DISPATCH_BUNDLE =
  "// === AUTOPUS DISPATCH BUNDLE (SPEC-FIGMA-021) ===\n" +
  bundle.outputFiles[0].text +
  "\n";
console.log("build-figma-plugin: dispatcher bundled (AutopusDispatch IIFE)");

// Patch: prepend a marker comment and append a small autopus dispatcher that
// wraps `handleCommand` to handle description-workflow command names that
// vendor does not know about.
const HEADER = [
  "// === BUILT BY scripts/build-figma-plugin.mjs ===",
  "// Vendor source: vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/code.js",
  "// Autopus additions: description workflow command handlers (SPEC-FIGMA-007/011).",
  "// Do NOT edit this file directly — re-run `node scripts/build-figma-plugin.mjs`.",
  "",
].join("\n");

const AUTOPUS_PATCH = `
// === AUTOPUS PATCH (SPEC-FIGMA-007/011 description workflow) ===
// Appended after vendor handleCommand to extend it with description ops.
(function attachAutopusHandlers() {
  if (typeof handleCommand !== 'function') {
    console.warn('autopus patch: handleCommand not found — vendor code.js out of sync');
    return;
  }
  const vendorHandleCommand = handleCommand;
  handleCommand = async function (command, params) {
    switch (command) {
      case 'set_text_content': {
        // Robust override of the vendor handler, which calls
        // figma.loadFontAsync(node.fontName) up front — that throws
        // "Cannot unwrap symbol" when fontName is figma.mixed (a Symbol).
        // Mixed nodes are common here (cards built via the official plugin
        // carry SemiBold headers + Regular body). Load every font present,
        // collapse to the first-char font, then replace characters. Callers
        // restore visual hierarchy afterwards via set_range_font.
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error('node_not_found');
        if (node.type !== 'TEXT') throw new Error('not_a_text_node');
        const len = node.characters.length;
        if (node.fontName === figma.mixed) {
          if (len > 0) {
            for (const f of node.getRangeAllFontNames(0, len)) {
              await figma.loadFontAsync(f);
            }
            const first = node.getRangeFontName(0, 1);
            await figma.loadFontAsync(first);
            node.fontName = first;
          } else {
            const fallback = { family: 'Inter', style: 'Regular' };
            await figma.loadFontAsync(fallback);
            node.fontName = fallback;
          }
        } else {
          await figma.loadFontAsync(node.fontName);
        }
        node.characters = String(params.text == null ? '' : params.text);
        return { id: node.id, name: node.name, characters: node.characters };
      }
      case 'set_stroke_color': {
        // Vendor setStrokeColor destructures params.color.{r,g,b,a}, but the
        // daemon sends FLAT { nodeId, r, g, b, a, weight } — that mismatch threw
        // "Cannot convert undefined to object". Accept the flat shape here.
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error('node_not_found');
        if (!('strokes' in node)) throw new Error('node_does_not_support_strokes');
        const r = params.r != null ? Number(params.r) : 0;
        const g = params.g != null ? Number(params.g) : 0;
        const b = params.b != null ? Number(params.b) : 0;
        const a = params.a != null ? Number(params.a) : 1;
        node.strokes = [{ type: 'SOLID', color: { r, g, b }, opacity: a }];
        if (params.weight != null) node.strokeWeight = Number(params.weight);
        return { ok: true, nodeId: params.nodeId };
      }
      case 'create_text': {
        // Vendor create_text creates an EMPTY auto-width node (the text param
        // is ignored and the font may be unloaded), forcing a second
        // set_text_content call and causing the upstream text-creation
        // timeout. Create with characters + a loaded font in one call.
        const family = String(params.fontFamily || 'Inter');
        const weight = Number(params.fontWeight) || 400;
        const style =
          weight >= 700 ? 'Bold'
          : weight >= 600 ? 'Semi Bold'
          : weight >= 500 ? 'Medium'
          : 'Regular';
        await figma.loadFontAsync({ family, style });
        const text = figma.createText();
        text.fontName = { family, style };
        if (params.fontSize != null) text.fontSize = Number(params.fontSize);
        text.characters = String(params.text == null ? '' : params.text);
        if (params.fontColor) {
          const c = params.fontColor;
          text.fills = [{
            type: 'SOLID',
            color: { r: Number(c.r) || 0, g: Number(c.g) || 0, b: Number(c.b) || 0 },
            opacity: c.a != null ? Number(c.a) : 1,
          }];
        }
        if (params.x != null) text.x = Number(params.x);
        if (params.y != null) text.y = Number(params.y);
        if (params.name) text.name = String(params.name);
        if (params.parentId) {
          const parent = await figma.getNodeByIdAsync(params.parentId);
          if (parent && 'appendChild' in parent) parent.appendChild(text);
        }
        return {
          id: text.id,
          name: text.name,
          characters: text.characters,
          fontName: text.fontName,
        };
      }
      case 'create_image': {
        // The daemon fetched the bytes (plugin networkAccess is localhost-only)
        // and forwarded base64. Decode -> createImage -> IMAGE-filled rectangle.
        const b64 = String(params.imageBase64 || '');
        if (!b64) throw new Error('missing_image_bytes');
        const bytes = figma.base64Decode(b64);
        const image = figma.createImage(bytes);
        const node = figma.createRectangle();
        const w = params.width != null ? Number(params.width) : 200;
        const h = params.height != null ? Number(params.height) : 200;
        node.resize(w, h);
        node.fills = [{
          type: 'IMAGE',
          scaleMode: params.scaleMode || 'FILL',
          imageHash: image.hash,
        }];
        if (params.x != null) node.x = Number(params.x);
        if (params.y != null) node.y = Number(params.y);
        if (params.name) node.name = String(params.name);
        if (params.parentId) {
          const parent = await figma.getNodeByIdAsync(params.parentId);
          if (parent && 'appendChild' in parent) parent.appendChild(node);
        }
        return {
          id: node.id,
          name: node.name,
          imageHash: image.hash,
          width: node.width,
          height: node.height,
        };
      }
      case 'set_plugin_data': {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error('node_not_found');
        node.setPluginData(params.key || 'autopus', String(params.value || ''));
        return { ok: true, nodeId: params.nodeId };
      }
      case 'clear_plugin_data': {
        const node = await figma.getNodeByIdAsync(params.node_id);
        if (!node) throw new Error('node_not_found');
        node.setPluginData(params.key || 'autopus', '');
        return { ok: true };
      }
      case 'set_frame_name': {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error('node_not_found');
        if (node.type !== 'FRAME') throw new Error('not_a_frame');
        node.name = String(params.name || node.name);
        return { ok: true };
      }
      case 'restore_frame_name': {
        const node = await figma.getNodeByIdAsync(params.node_id);
        if (!node) throw new Error('node_not_found');
        node.name = String(params.original_name || node.name);
        return { ok: true };
      }
      case 'rename_node': {
        // Generic layer rename for any node type (frames, text, groups, etc.).
        // Unlike set_frame_name this is not restricted to FRAME nodes.
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error('node_not_found');
        node.name = String(params.name == null ? node.name : params.name);
        return { id: node.id, name: node.name };
      }
      case 'upsert_descriptions_page_node': {
        // Find or create a page named pageName; append a TEXT node with text.
        const targetPageName = String(params.pageName || 'Descriptions');
        let page = figma.root.children.find(
          (p) => p.type === 'PAGE' && p.name === targetPageName,
        );
        if (!page) {
          page = figma.createPage();
          page.name = targetPageName;
        }
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        const text = figma.createText();
        text.characters = String(params.text || '');
        page.appendChild(text);
        return { ok: true, id: text.id };
      }
      case 'set_range_font': {
        // Apply font style/size to character ranges of a text node.
        // Preserves visual hierarchy after set_text_content replaces all characters.
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error('node_not_found');
        if (node.type !== 'TEXT') throw new Error('not_a_text_node');

        // Determine the base font family: explicit param > node uniform family > first-char family.
        let baseFamily;
        if (params.fontFamily) {
          baseFamily = String(params.fontFamily);
        } else if (node.fontName !== figma.mixed) {
          baseFamily = node.fontName.family;
        } else {
          baseFamily = node.getRangeFontName(0, 1).family;
        }

        const ranges = Array.isArray(params.ranges) ? params.ranges : [];
        const charLen = node.characters.length;
        const skipped = [];
        const toLoad = new Map(); // key="family|style" => {family, style}

        // First pass: collect all font variants we need to load.
        for (const r of ranges) {
          const start = Number(r.start);
          const end = Number(r.end);
          if (start < 0 || end > charLen || start >= end) {
            skipped.push({ start, end, reason: 'out_of_bounds' });
            continue;
          }
          // Resolve the style for this range: explicit > current range style > Regular.
          let style;
          if (r.fontStyle) {
            style = String(r.fontStyle);
          } else {
            const cur = node.getRangeFontName(start, start + 1);
            style = (cur !== figma.mixed) ? cur.style : 'Regular';
          }
          const key = baseFamily + '|' + style;
          if (!toLoad.has(key)) toLoad.set(key, { family: baseFamily, style });
        }

        // Figma requires every font CURRENTLY present in the node to be loaded
        // before any range edit — even ranges we are about to overwrite. Collect
        // existing fonts so a mixed node (Regular body + SemiBold headers) does
        // not fail with "unloaded font" on the first setRangeFontName call.
        if (charLen > 0) {
          const existing = node.getRangeAllFontNames(0, charLen);
          for (const f of existing) {
            const key = f.family + '|' + f.style;
            if (!toLoad.has(key)) toLoad.set(key, { family: f.family, style: f.style });
          }
        }

        // Load all required fonts before any setRange call (avoids partial apply).
        for (const fontName of toLoad.values()) {
          await figma.loadFontAsync(fontName);
        }

        // Second pass: apply font name and size to each valid range.
        let appliedRanges = 0;
        for (const r of ranges) {
          const start = Number(r.start);
          const end = Number(r.end);
          if (start < 0 || end > charLen || start >= end) continue; // already recorded
          let style;
          if (r.fontStyle) {
            style = String(r.fontStyle);
          } else {
            const cur = node.getRangeFontName(start, start + 1);
            style = (cur !== figma.mixed) ? cur.style : 'Regular';
          }
          node.setRangeFontName(start, end, { family: baseFamily, style });
          if (r.fontSize != null) {
            node.setRangeFontSize(start, end, Number(r.fontSize));
          }
          appliedRanges++;
        }
        return { ok: true, nodeId: params.nodeId, appliedRanges, skipped };
      }
      case 'set_native_annotation':
      case 'set_policy_card':
      // SPEC-FIGMA-022 — set_annotation now routes to the dispatcher's NATIVE
      // arm (node.annotations), matching the MCP tool description. The legacy
      // text-card path moved to set_annotation_card, which MUST also be routed
      // to the dispatcher: vendor handleCommand does not know set_annotation_card
      // and would throw "Unknown command", so it cannot fall through to default.
      case 'set_annotation':
      case 'set_annotation_card':
      // SPEC-FIGMA-021 REQ-06 — the compound-undo inverse ops MUST also route to
      // the bundled dispatcher: restore_annotation is unknown to vendor (would
      // throw "Unknown command"), and the undo path sends delete_node with a
      // snake_case { node_id } that vendor's deleteNode (reads params.nodeId)
      // rejects with "Missing nodeId parameter". dispatchInverse handles both
      // (delete_node tolerates node_id/nodeId; restore_annotation writes the
      // prior snapshot back via the adapter), so one undo reverses both surfaces.
      case 'delete_node':
      case 'restore_annotation': {
        // SPEC-FIGMA-021 — delegate to the bundled canonical dispatcher built
        // from the LIVE figma global. The dispatcher redacts, renders, and
        // returns { ok, node_ids } directly; the bridge normalizes from there.
        const adapter = AutopusDispatch.createAutopusPluginAdapter(figma);
        return await AutopusDispatch.dispatchPluginCommand(adapter, { op: command, args: params });
      }
      case 'noop':
        return { ok: true };
      default:
        return vendorHandleCommand(command, params);
    }
  };
  console.log('autopus patch: handleCommand wrapped with description ops');
})();
`;

// Inject the dispatcher IIFE BETWEEN the HEADER and the (analytics-stripped)
// vendorCodeJs so the vendor body stays contiguous and byte-identical (S6).
const patchedCode =
  HEADER + DISPATCH_BUNDLE + vendorCodeJs + "\n" + AUTOPUS_PATCH;
writeFileSync(join(outDir, "code.js"), patchedCode, "utf8");
console.log(
  `build-figma-plugin: code.js (vendor ${vendorCodeJs.split("\n").length} lines + autopus patch)`,
);

// 3) UI — vendor ui.html + autopus WebSocket bridge injection.
//    The vendor ui.html only renders a status strip; for SPEC-FIGMA-017 the
//    plugin must also auto-connect to the daemon relay at ws://localhost:3055
//    and forward broadcasts to code.js as execute-command messages. We inject
//    the bridge as a <script> block before </body>.
//    Bridge source lives in scripts/plugin-ui-bridge.js (kept separate to
//    respect the 300-line file-size limit on build scripts).
const bridgeSrc = readFileSync(join(here, "plugin-ui-bridge.js"), "utf8");
const UI_BRIDGE = `\n    <script>\n${bridgeSrc
  .split("\n")
  .map((l) => "      " + l)
  .join("\n")}\n    </script>\n`;

const vendorUiHtml = readFileSync(join(vendorPluginDir, "ui.html"), "utf8");
const patchedUiHtml = vendorUiHtml.replace(
  /<\/body>/i,
  UI_BRIDGE + "  </body>",
);
writeFileSync(join(outDir, "ui.html"), patchedUiHtml, "utf8");
console.log("build-figma-plugin: ui.html (vendor + WebSocket bridge)");

// 4) setcharacters.js — vendor verbatim (used by text APIs)
if (existsSync(join(vendorPluginDir, "setcharacters.js"))) {
  copyFileSync(
    join(vendorPluginDir, "setcharacters.js"),
    join(outDir, "setcharacters.js"),
  );
  console.log("build-figma-plugin: setcharacters.js (copied)");
}

console.log(`\nbuild-figma-plugin: ✓ dist/plugin/ ready`);
console.log(`  Import to Figma: Plugins → Development → Import from manifest`);
console.log(`  Manifest path: ${join(outDir, "manifest.json")}`);
