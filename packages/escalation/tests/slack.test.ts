import { describe, it, expect, vi } from "vitest";
import {
  SlackEscalator,
  ERR_NOT_CONFIGURED,
  renderMessage,
  SLACK_API_URL,
  type EscalatePayload,
  type SlackTransport,
} from "../src/slack.js";

function payload(): EscalatePayload {
  return {
    frameId: "AUTH-01",
    intentMismatchReason: "Confidence below 0.7",
    draftText: "사용자 인증 게이트",
    deepLink: "https://www.figma.com/file/X/Y?node-id=1:1",
    designerSlackUserId: "U0DESIGNER",
  };
}

function makeTransport(
  status = 200,
  body: unknown = { ok: true, ts: "1729000000.000100" },
): SlackTransport & { calls: Array<unknown> } {
  const calls: Array<unknown> = [];
  return {
    calls,
    async post(args) {
      calls.push(args);
      return { status, body };
    },
  };
}

describe("SlackEscalator (REQ-20)", () => {
  it("isConfigured returns false when no botToken is supplied", () => {
    const e = new SlackEscalator();
    expect(e.isConfigured()).toBe(false);
  });

  it("escalate throws SLACK_NOT_CONFIGURED when botToken is missing", async () => {
    const e = new SlackEscalator();
    await expect(e.escalate(payload())).rejects.toThrow(ERR_NOT_CONFIGURED);
  });

  it("escalate posts to the Slack chat.postMessage URL with bearer auth", async () => {
    const transport = makeTransport();
    const e = new SlackEscalator({ botToken: "xoxb-DUMMY", transport });
    const result = await e.escalate(payload());
    expect(result.ok).toBe(true);
    expect(result.messageTs).toBe("1729000000.000100");
    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0] as {
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(call.url).toBe(SLACK_API_URL);
    expect(call.headers.authorization).toBe("Bearer xoxb-DUMMY");
    expect(call.headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(call.body);
    expect(parsed.channel).toBe("U0DESIGNER");
    expect(parsed.text).toContain("AUTH-01");
    expect(parsed.text).toContain("사용자 인증 게이트");
  });

  it("escalate uses defaultChannel when payload omits designerSlackUserId", async () => {
    const transport = makeTransport();
    const e = new SlackEscalator({
      botToken: "xoxb-DUMMY",
      defaultChannel: "#design-review",
      transport,
    });
    const p = { ...payload() };
    delete p.designerSlackUserId;
    await e.escalate(p);
    const call = transport.calls[0] as { body: string };
    expect(JSON.parse(call.body).channel).toBe("#design-review");
  });

  it("escalate throws SLACK_CHANNEL_REQUIRED when no channel can be resolved", async () => {
    const transport = makeTransport();
    const e = new SlackEscalator({ botToken: "xoxb-DUMMY", transport });
    const p = { ...payload() };
    delete p.designerSlackUserId;
    await expect(e.escalate(p)).rejects.toThrow(/SLACK_CHANNEL_REQUIRED/);
    expect(transport.calls).toHaveLength(0);
  });

  it("escalate returns ok=false on non-200 HTTP status", async () => {
    const transport = makeTransport(500, { error: "internal" });
    const e = new SlackEscalator({ botToken: "xoxb-DUMMY", transport });
    const result = await e.escalate(payload());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("http 500");
  });

  it("escalate returns ok=false when Slack body has ok=false", async () => {
    const transport = makeTransport(200, { ok: false, error: "channel_not_found" });
    const e = new SlackEscalator({ botToken: "xoxb-DUMMY", transport });
    const result = await e.escalate(payload());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("channel_not_found");
  });
});

describe("renderMessage", () => {
  it("includes frame id, reason, draft, and deep link", () => {
    const text = renderMessage(payload());
    expect(text).toContain("AUTH-01");
    expect(text).toContain("Confidence below 0.7");
    expect(text).toContain("사용자 인증 게이트");
    expect(text).toContain("https://www.figma.com/file/X/Y?node-id=1:1");
  });

  it("redacts figd_/xoxb- tokens in draftText and intentMismatchReason", () => {
    const leaky: EscalatePayload = {
      ...payload(),
      intentMismatchReason: "Pasted xoxb-TESTABCDE12345 by mistake",
      draftText: "draft with figd_TESTTOKEN1234567890ABCDEF in body",
    };
    const text = renderMessage(leaky);
    expect(text).toContain("<REDACTED>");
    expect(text).not.toMatch(/figd_[A-Za-z0-9_-]{16,}/);
    expect(text).not.toMatch(/xoxb-[A-Za-z0-9_-]{8,}/);
    // The deep-link URL must NOT be redacted (no figd_/xoxb- shape).
    expect(text).toContain("https://www.figma.com/file/X/Y?node-id=1:1");
  });
});
