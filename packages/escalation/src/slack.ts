// SPEC-FIGMA-004 Slack designer escalation (REQ-20).
// Sends a DM to the designated designer with a Figma deep-link, the
// intent_mismatch reason, and the current draft. When no bot token is
// configured, escalation throws SLACK_NOT_CONFIGURED so the UI can disable
// the escalate button + render a tooltip explaining the missing prerequisite.

import { redactTokens } from "@autopus/write-router/redactor";

export const SLACK_API_URL = "https://slack.com/api/chat.postMessage";
export const ERR_NOT_CONFIGURED = "SLACK_NOT_CONFIGURED";

export interface EscalatePayload {
  frameId: string;
  intentMismatchReason: string;
  draftText: string;
  deepLink: string;
  designerSlackUserId?: string;
}

export interface EscalateResult {
  ok: boolean;
  messageTs?: string;
  error?: string;
}

export interface SlackTransport {
  post(args: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ status: number; body: unknown }>;
}

export interface SlackEscalatorOptions {
  botToken?: string;
  defaultChannel?: string;
  transport?: SlackTransport;
}

const fetchTransport: SlackTransport = {
  async post({ url, headers, body }) {
    const res = await fetch(url, { method: "POST", headers, body });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  },
};

export class SlackEscalator {
  private readonly botToken?: string;
  private readonly defaultChannel?: string;
  private readonly transport: SlackTransport;

  constructor(opts: SlackEscalatorOptions = {}) {
    this.botToken = opts.botToken;
    this.defaultChannel = opts.defaultChannel;
    this.transport = opts.transport ?? fetchTransport;
  }

  isConfigured(): boolean {
    return typeof this.botToken === "string" && this.botToken.length > 0;
  }

  async escalate(payload: EscalatePayload): Promise<EscalateResult> {
    if (!this.isConfigured()) {
      throw new Error(ERR_NOT_CONFIGURED);
    }
    const channel = payload.designerSlackUserId ?? this.defaultChannel;
    if (!channel) {
      throw new Error("SLACK_CHANNEL_REQUIRED");
    }
    const text = renderMessage(payload);
    const res = await this.transport.post({
      url: SLACK_API_URL,
      headers: {
        authorization: `Bearer ${this.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text }),
    });
    if (res.status !== 200) {
      return { ok: false, error: `http ${res.status}` };
    }
    const body = res.body as { ok?: boolean; ts?: string; error?: string };
    if (!body || body.ok !== true) {
      return { ok: false, error: body?.error ?? "unknown" };
    }
    return { ok: true, messageTs: body.ts };
  }
}

export function renderMessage(payload: EscalatePayload): string {
  // Defense-in-depth: PM-supplied draft/reason fields can occasionally
  // contain pasted credentials. REQ-13 scopes redaction to audit log / UI /
  // error messages — this surface is none of those, but redacting tokens
  // before the Slack DM ships removes a credential-leak path no one expected.
  const lines = [
    `🔍 Description review needed — ${payload.frameId}`,
    `Reason: ${redactTokens(payload.intentMismatchReason)}`,
    `Draft: ${redactTokens(payload.draftText)}`,
    `Open in Figma: ${payload.deepLink}`,
  ];
  return lines.join("\n");
}
