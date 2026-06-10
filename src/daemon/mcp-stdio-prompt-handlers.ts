// SPEC-MCP-001 REQ-04 / REQ-05 / REQ-06 / REQ-07 / REQ-08 — additive prompts
// capability for the autopus MCP server. Registers ListPrompts and GetPrompt
// request handlers that expose the frame-description workflow as an explicit
// /mcp__autopus-figma__<prompt> slash command.
//
// This handler lives in its own module (HC-1) so mcp-stdio-handlers.ts (314
// lines) is not pushed over the 300-line limit.
//
// HC-3 / REQ-08: this handler never receives the figmaChannel secret and MUST
// NOT emit it. The language line (REQ-07) is computed inside the GetPrompt
// handler so a mid-session getter mutation is reflected per request (S5).

import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { FRAME_DESCRIPTION_WORKFLOW } from "./figma-workflow-guidance.js";

// @AX:NOTE: [AUTO] magic constant — must match the ListPrompts descriptor and
// the GetPrompt dispatch guard below, and the slash-command name the client
// invokes (/mcp__autopus-figma__generate_frame_descriptions).
const PROMPT_NAME = "generate_frame_descriptions";
const PROMPT_DESCRIPTION =
  "Guides the dryRun → approve → apply frame-description workflow " +
  "(undo reverses the last write).";

export interface PromptHandlerContext {
  /** Live getter for the plugin-selected description language (read per call). */
  readonly descriptionLanguage?: () => string;
}

/**
 * Register the prompts capability request handlers on an SDK Server. Additive
 * only — does not touch the existing resources/tools surface (REQ-09).
 */
export function registerPromptHandlers(
  server: Server,
  ctx: PromptHandlerContext = {},
): void {
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{ name: PROMPT_NAME, description: PROMPT_DESCRIPTION }],
  }));

  server.setRequestHandler(GetPromptRequestSchema, (req) => {
    const name = req.params.name;
    if (name !== PROMPT_NAME) {
      throw new McpError(ErrorCode.InvalidParams, `unknown prompt: ${name}`);
    }
    let text = FRAME_DESCRIPTION_WORKFLOW;
    // REQ-07 / HC-4: read the language getter live per request (S5).
    if (ctx.descriptionLanguage) {
      const lang = ctx.descriptionLanguage();
      text +=
        `\n\nActive description language: ${lang}. ` +
        `Write generated frame descriptions in this language.`;
    }
    return {
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  });
}
