// SPEC-FIGMA-007 REQ-01, REQ-09 — plan-emit helper for descriptions_page.
// Mirrors `applyDescriptionsPage` text composition (4-line block) and the
// fixed page name "Descriptions" so the plugin can upsert the same node.

import type { ManifestEntry } from "../types.js";
import type { PluginCommand } from "./types.js";

const DESCRIPTIONS_PAGE_NAME = "Descriptions";

function renderEntryText(entry: ManifestEntry): string {
  const lines = [
    `# ${entry.title} (${entry.screen_id})`,
    `Intent: ${entry.intent}`,
    `User value: ${entry.user_value}`,
    `Success criteria: ${entry.success_criteria}`,
  ];
  return lines.join("\n");
}

export function planDescriptionsPage(
  entry: ManifestEntry,
): readonly PluginCommand[] {
  const cmd: PluginCommand = {
    op: "upsert_descriptions_page_node",
    args: {
      pageName: DESCRIPTIONS_PAGE_NAME,
      text: renderEntryText(entry),
    },
  };
  return [cmd];
}
