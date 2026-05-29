// === AUTOPUS PATCH (SPEC-FIGMA-017 WebSocket bridge) ===
// Auto-connect to the daemon relay and bridge vendor design commands
// between WebSocket and Figma main thread (code.js). The channel name
// can be overridden by appending ?channel=name to the plugin URL but
// defaults to "autopus" — matching the daemon's default.
(function autopusBridge() {
  const params = new URLSearchParams(window.location.search || "");
  const CHANNEL = params.get("channel") || "autopus";
  const URL = "ws://localhost:3055";
  let ws = null;
  let connected = false;

  function setStatus(isConnected) {
    connected = isConnected;
    const dot = document.getElementById("conn-dot");
    const label = document.getElementById("conn-label");
    if (dot) dot.className = "dot " + (isConnected ? "connected" : "disconnected");
    if (label) label.textContent = isConnected
      ? ("Connected · channel=" + CHANNEL)
      : "Connecting…";
  }

  function sendToFigma(message) {
    parent.postMessage({ pluginMessage: message, pluginId: "*" }, "*");
  }

  function reply(id, body) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      id: id,
      type: "message",
      channel: CHANNEL,
      message: Object.assign({ id: id }, body),
    }));
  }

  function connect() {
    try {
      ws = new WebSocket(URL);
    } catch (e) {
      setStatus(false);
      setTimeout(connect, 2000);
      return;
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({
        id: "join-" + Date.now(),
        type: "join",
        channel: CHANNEL,
      }));
    };
    ws.onmessage = function (event) {
      let data;
      try { data = JSON.parse(event.data); } catch (_) { return; }
      if (!data || typeof data !== "object") return;
      if (data.type === "system") {
        const m = data.message;
        if (typeof m === "string" && m.indexOf("Joined channel") === 0) {
          setStatus(true);
        }
        return;
      }
      if (data.type === "broadcast" && data.message && data.message.command) {
        // Forward the command to code.js for Figma execution.
        sendToFigma({
          type: "execute-command",
          id: data.message.id,
          command: data.message.command,
          params: data.message.params || {},
        });
      }
    };
    ws.onclose = function () {
      setStatus(false);
      setTimeout(connect, 2000);
    };
    ws.onerror = function () { /* let onclose drive reconnect */ };
  }

  // code.js → UI → WebSocket: relay command results back to the daemon.
  window.addEventListener("message", function (event) {
    const msg = event && event.data && event.data.pluginMessage;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "command-result" && msg.id) {
      reply(msg.id, { result: msg.result });
    } else if (msg.type === "command-error" && msg.id) {
      reply(msg.id, { error: msg.error });
    }
  });

  setStatus(false);
  connect();
})();
