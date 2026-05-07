// SPEC-FIGMA-008 REQ-07, REQ-11 — plugin-side tunnel strip port tests.
//
// Asserts the vendor plugin's `formatTunnelStripText`, `renderTunnelStrip`,
// and `bindRevokeButton`:
//
//   * Render exactly one of the four allowed strings (off / attached / expired / revoked)
//   * NEVER expose the raw cloudflared URL or the bearer (REQ-08, REQ-11)
//   * Reveal the revoke button exclusively when state is attached
//   * On click, emit exactly one `tunnel.revoke` postMessage with the tunnel_session_id (AC-T7)

import { describe, it, expect } from "vitest";

import {
  formatTunnelStripText,
  renderTunnelStrip,
  bindRevokeButton,
  applyTunnelStrip,
  type TunnelStripDom,
  type TunnelStripState,
  type RevokeMessageSink,
} from "../../vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/autopus_tunnel_strip.js";

function makeDom(): TunnelStripDom & { _text: { textContent: string | null }; _button: { hidden: boolean; onclick: ((ev?: unknown) => void) | null } } {
  const text = { textContent: null as string | null };
  const button = { hidden: true as boolean, onclick: null as ((ev?: unknown) => void) | null };
  return { text, button, _text: text, _button: button };
}

class CapturingSink implements RevokeMessageSink {
  readonly outbox: Array<{ type: "tunnel.revoke"; tunnel_session_id: string }> = [];
  postMessage(msg: { type: "tunnel.revoke"; tunnel_session_id: string }): void {
    this.outbox.push(msg);
  }
}

describe("plugin-tunnel-strip — formatTunnelStripText literal oracles", () => {
  it("off → 'tunnel: off'", () => {
    expect(formatTunnelStripText({ kind: "off" })).toBe("tunnel: off");
  });

  it("attached → 'tunnel: <8charhash>'", () => {
    expect(formatTunnelStripText({ kind: "attached", urlHash8: "a3f9c2e1", tunnelSessionId: "ts_X" })).toBe(
      "tunnel: a3f9c2e1",
    );
  });

  it("expired → 'tunnel: expired'", () => {
    expect(formatTunnelStripText({ kind: "expired" })).toBe("tunnel: expired");
  });

  it("revoked → 'tunnel: revoked'", () => {
    expect(formatTunnelStripText({ kind: "revoked" })).toBe("tunnel: revoked");
  });

  it("falls back to 8x'0' on malformed urlHash8 (defense vs. malformed daemon push)", () => {
    expect(formatTunnelStripText({ kind: "attached", urlHash8: "not-hex", tunnelSessionId: "ts_X" })).toBe(
      "tunnel: 00000000",
    );
  });

  it("never embeds a trycloudflare URL even if state is malformed", () => {
    const malformed: TunnelStripState = {
      kind: "attached",
      urlHash8: "https://abc-123.trycloudflare.com" as unknown as string,
      tunnelSessionId: "ts_X",
    };
    expect(formatTunnelStripText(malformed)).not.toContain("trycloudflare.com");
  });
});

describe("plugin-tunnel-strip — renderTunnelStrip toggles button visibility", () => {
  it("off state → button hidden, onclick cleared", () => {
    const dom = makeDom();
    dom._button.hidden = false;
    dom._button.onclick = () => undefined;
    renderTunnelStrip(dom, { kind: "off" });
    expect(dom._button.hidden).toBe(true);
    expect(dom._button.onclick).toBe(null);
    expect(dom._text.textContent).toBe("tunnel: off");
  });

  it("attached state → button visible (binding done separately)", () => {
    const dom = makeDom();
    renderTunnelStrip(dom, { kind: "attached", urlHash8: "deadbeef", tunnelSessionId: "ts_REVOKE01" });
    expect(dom._button.hidden).toBe(false);
    expect(dom._text.textContent).toBe("tunnel: deadbeef");
  });

  it("revoked state → button hidden", () => {
    const dom = makeDom();
    dom._button.hidden = false;
    renderTunnelStrip(dom, { kind: "revoked" });
    expect(dom._button.hidden).toBe(true);
    expect(dom._text.textContent).toBe("tunnel: revoked");
  });

  it("expired state → button hidden", () => {
    const dom = makeDom();
    dom._button.hidden = false;
    renderTunnelStrip(dom, { kind: "expired" });
    expect(dom._button.hidden).toBe(true);
    expect(dom._text.textContent).toBe("tunnel: expired");
  });
});

describe("plugin-tunnel-strip — bindRevokeButton emits one tunnel.revoke message", () => {
  it("clicking the bound button sends exactly one tunnel.revoke msg with the session id", () => {
    const dom = makeDom();
    dom._button.hidden = false;
    const sink = new CapturingSink();
    bindRevokeButton(dom, sink, "ts_REVOKE01");
    expect(typeof dom._button.onclick).toBe("function");
    dom._button.onclick?.();
    expect(sink.outbox).toEqual([{ type: "tunnel.revoke", tunnel_session_id: "ts_REVOKE01" }]);
  });

  it("subsequent clicks after bind do not re-emit (button hidden + onclick cleared)", () => {
    const dom = makeDom();
    dom._button.hidden = false;
    const sink = new CapturingSink();
    bindRevokeButton(dom, sink, "ts_REVOKE01");
    dom._button.onclick?.();
    expect(dom._button.hidden).toBe(true);
    expect(dom._button.onclick).toBe(null);
    // Re-click attempts (e.g., hammered click) — button is now disabled.
    expect(sink.outbox.length).toBe(1);
  });
});

describe("plugin-tunnel-strip — applyTunnelStrip end-to-end", () => {
  it("attached state → renders + binds revoke", () => {
    const dom = makeDom();
    const sink = new CapturingSink();
    applyTunnelStrip(dom, sink, { kind: "attached", urlHash8: "abcdef01", tunnelSessionId: "ts_TEST_SESSION_ID_1" });
    expect(dom._text.textContent).toBe("tunnel: abcdef01");
    expect(dom._button.hidden).toBe(false);
    dom._button.onclick?.();
    expect(sink.outbox).toEqual([{ type: "tunnel.revoke", tunnel_session_id: "ts_TEST_SESSION_ID_1" }]);
  });

  it("non-attached state → renders without binding", () => {
    const dom = makeDom();
    const sink = new CapturingSink();
    applyTunnelStrip(dom, sink, { kind: "off" });
    expect(dom._text.textContent).toBe("tunnel: off");
    expect(dom._button.hidden).toBe(true);
    expect(dom._button.onclick).toBe(null);
    expect(sink.outbox.length).toBe(0);
  });
});
