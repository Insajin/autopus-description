// SPEC-FIGMA-008 REQ-07, REQ-11, AC-T7, AC-T11 — plugin-side tunnel strip port.
//
// Owns the four-state status strip line displayed in the autopus plugin status
// panel (`autopus_status_panel.html`):
//
//   "tunnel: off"            (REQ-11 default-safe — initial + closed_clean)
//   "tunnel: <8charhash>"    (REQ-11 attached — first 8 hex chars of sha256(url))
//   "tunnel: expired"        (REQ-11 / REQ-04 TTL expiry)
//   "tunnel: revoked"        (REQ-07 / REQ-11 revoke)
//
// The strip MUST NEVER expose the raw cloudflared URL or the bearer (REQ-08,
// REQ-11 prohibition). The revoke button is rendered exclusively when state
// is attached; on click it emits ONE `tunnel.revoke` postMessage to the
// daemon side via the WebSocket bridge.

export type TunnelStripState =
  | { kind: "off" }
  | { kind: "attached"; urlHash8: string; tunnelSessionId: string }
  | { kind: "expired" }
  | { kind: "revoked" };

export interface TunnelStripDom {
  readonly text: { textContent: string | null };
  readonly button: { hidden: boolean; onclick: ((ev?: unknown) => void) | null };
}

export interface RevokeMessageSink {
  postMessage(msg: { type: "tunnel.revoke"; tunnel_session_id: string }): void;
}

/**
 * Render the tunnel strip text and toggle the revoke button visibility based
 * on the current state. Pure DOM mutation; no network I/O.
 */
export function renderTunnelStrip(dom: TunnelStripDom, state: TunnelStripState): void {
  dom.text.textContent = formatTunnelStripText(state);
  if (state.kind === "attached") {
    dom.button.hidden = false;
  } else {
    dom.button.hidden = true;
    dom.button.onclick = null;
  }
}

/**
 * Format the strip text. Exposed for unit tests + non-DOM consumers.
 */
export function formatTunnelStripText(state: TunnelStripState): string {
  switch (state.kind) {
    case "off":
      return "tunnel: off";
    case "attached":
      return `tunnel: ${ensureHash8(state.urlHash8)}`;
    case "expired":
      return "tunnel: expired";
    case "revoked":
      return "tunnel: revoked";
    default: {
      const exhaustive: never = state;
      void exhaustive;
      return "tunnel: off";
    }
  }
}

/**
 * Wire the revoke button click handler. Called whenever the strip is
 * (re-)rendered into the attached state. Emits exactly one postMessage and
 * disables the button until the next state transition.
 */
export function bindRevokeButton(
  dom: TunnelStripDom,
  sink: RevokeMessageSink,
  tunnelSessionId: string,
): void {
  dom.button.onclick = () => {
    sink.postMessage({ type: "tunnel.revoke", tunnel_session_id: tunnelSessionId });
    dom.button.hidden = true;
    dom.button.onclick = null;
  };
}

/**
 * Convenience: render + bind in one call when the state is `attached`.
 */
export function applyTunnelStrip(
  dom: TunnelStripDom,
  sink: RevokeMessageSink,
  state: TunnelStripState,
): void {
  renderTunnelStrip(dom, state);
  if (state.kind === "attached") {
    bindRevokeButton(dom, sink, state.tunnelSessionId);
  }
}

function ensureHash8(raw: string): string {
  if (typeof raw !== "string") return "00000000";
  if (!/^[a-f0-9]{8}$/.test(raw)) {
    // Defensive — REQ-08/REQ-11 require an 8-char hex prefix; if the daemon
    // ever pushes a malformed value, fall back to a placeholder rather than
    // exposing whatever string happened to arrive.
    return "00000000";
  }
  return raw;
}
