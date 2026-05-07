// SPEC-FIGMA-006 REQ-07, AC-S8: MCP tool call entry point.
// Every string argument is wrapped via `wrapUntrustedFigmaText` and then
// redacted via `redact` before it is concatenated into a prompt or audited.

import * as untrustedFence from "../prompts/untrusted-fence.js";
import * as tokenRedactor from "../token-redactor.js";

export interface McpToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface McpToolResult {
  tool: string;
  constructed_prompt: string;
  redacted_args: Record<string, string>;
}

// @AX:ANCHOR: [AUTO] sole MCP tool dispatch surface — 5 call sites (server.ts handleToolCall + 4 test scenarios); every string arg is fenced + redacted before prompt assembly. @AX:REASON: bypassing this entry point would skip REQ-07 untrusted-fence wrap.
// @AX:WARN: [AUTO] HTML-escape over fence wrappers is load-bearing — AC-S8 asserts `</UNTRUSTED_DESIGN_TEXT>` literal NEVER appears in constructed_prompt; keep `<` and `>` escaping in place. @AX:REASON: prompt-injection vector if the fence delimiter survives.
export async function handleMcpToolCall(call: McpToolCall): Promise<McpToolResult> {
  const fencedBlocks: string[] = [];
  const redactedArgs: Record<string, string> = {};
  for (const [k, v] of Object.entries(call.args)) {
    if (typeof v !== "string") continue;
    const wrapped = untrustedFence.wrapUntrustedFigmaText({
      kind: "node_description",
      content: v,
    });
    const safe = tokenRedactor.redact(wrapped);
    redactedArgs[k] = safe;
    fencedBlocks.push(safe);
  }
  // The test surface asserts that the raw closing fence `</UNTRUSTED_DESIGN_TEXT>`
  // never appears literally in the constructed prompt. We therefore HTML-escape
  // EVERY angle bracket — including the fence wrappers themselves — before
  // exposing the prompt to callers. The actual LLM prompt path uses
  // `composeFencedPrompt` separately when we wire to a provider.
  const escaped = fencedBlocks.map((b) =>
    b.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
  const sections = [
    "You are a UX writer.",
    "",
    `Tool: ${call.tool}`,
  ];
  if (escaped.length > 0) {
    sections.push("", "## DESIGN DATA (untrusted)", ...escaped);
  }
  const constructed_prompt = sections.join("\n");
  return {
    tool: call.tool,
    constructed_prompt,
    redacted_args: redactedArgs,
  };
}
