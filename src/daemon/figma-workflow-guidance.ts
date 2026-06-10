// SPEC-MCP-001 REQ-01 — Single source-of-truth for the frame-description
// workflow guidance shared across the stdio entry, the http session, and the
// prompts handler. This is an operational tool-ordering layer derived from
// .claude/skills/autopus/figma-description.md; it does NOT redefine the
// description body voice (that lives in src/prompts/node-only.ts, SPEC-FIGMA-003).
//
// HC-5: the shared body names only tools registered on BOTH transports. The
// stdio-only get_description_language tool and the per-session channel secret
// are appended OUTSIDE this constant (stdio instructions / prompts language
// line) so the http transport never advertises a tool it does not register.

/**
 * Ordered frame-description workflow guidance. The first occurrence of "dryRun"
 * precedes the first "approve" which precedes the first "apply"; "undo" appears
 * as the reversal step after apply. Names only shared-transport tools.
 */
// @AX:ANCHOR: [AUTO] single source-of-truth — fan-in 3 production consumers
// @AX:REASON: SPEC-MCP-001 REQ-01 — this constant is the only definition of the
// frame-description workflow text; consumed by mcp-stdio-entry.ts (instructions
// base), mcp-http-session-manager.ts (instructions), and mcp-stdio-prompt-
// handlers.ts (GetPrompt body). Edits here change all three transports/surfaces
// at once and the step-ordering invariant is asserted by the acceptance oracle.
export const FRAME_DESCRIPTION_WORKFLOW: string =
  `Autopus frame-description workflow — drive these tools in order:\n` +
  `\n` +
  `1. Discover targets: call get_active_selection for the frames the user ` +
  `selected in Figma, or get_stale_frames to find frames whose descriptions ` +
  `are out of date. Use get_pending_descriptions to see queued work.\n` +
  `2. Preview: call dryRun to generate the description cards and number badges ` +
  `and preview the planned write without touching the canvas (plan_emit ` +
  `prepares the write plan dryRun previews).\n` +
  `3. Approve: review the dryRun preview, then call approve to gate the write. ` +
  `Nothing reaches the Figma canvas until approve passes.\n` +
  `4. Apply: call apply to write the approved descriptions and badges into the ` +
  `frames.\n` +
  `5. Reverse: call undo to roll back the last applied write if needed.\n` +
  `\n` +
  `Inspect history with get_audit_events. Descriptions are screen/feature ` +
  `definitions for PM, design, dev, and QA — not implementation captions; ` +
  `never invent API, DB, event, or component identifiers.`;

export interface RenderWorkflowOptions {
  /** Live getter for the plugin-selected description language (read per call). */
  readonly descriptionLanguage?: () => string;
}

/**
 * Render the workflow instructions. The no-arg call returns exactly
 * FRAME_DESCRIPTION_WORKFLOW (the common block asserted to be a substring of
 * both stdio and http instructions). When a language getter is provided, a
 * language line literally including the getter's returned value is appended.
 */
export function renderWorkflowInstructions(opts?: RenderWorkflowOptions): string {
  if (!opts?.descriptionLanguage) {
    return FRAME_DESCRIPTION_WORKFLOW;
  }
  const lang = opts.descriptionLanguage();
  return (
    `${FRAME_DESCRIPTION_WORKFLOW}\n\n` +
    `Active description language: ${lang}. ` +
    `Write generated frame descriptions in this language.`
  );
}
