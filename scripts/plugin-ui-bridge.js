// === AUTOPUS PATCH (SPEC-FIGMA-017 WebSocket bridge + C-1 channel consent) ===
// Bridge vendor design commands between the daemon relay and code.js. The relay
// now binds to a per-session SECRET channel (security audit C-1), so the plugin
// must be handed that secret. We render a small Connect form and only join after
// the operator enters the secret and clicks Connect — no auto-join to a fixed,
// guessable default. Appending ?channel=<secret> to the plugin URL still
// auto-connects for advanced/CI setups.
(function autopusBridge() {
  const params = new URLSearchParams(window.location.search || "");
  const URL_WS = "ws://localhost:3055";
  const STORE_KEY = "autopus.figma.channel";
  let ws = null;
  let connected = false;
  let channel = "";

  function readStored() {
    try {
      return window.localStorage.getItem(STORE_KEY) || "";
    } catch (_) {
      return "";
    }
  }
  function writeStored(v) {
    try {
      window.localStorage.setItem(STORE_KEY, v);
    } catch (_) {
      /* iframe localStorage may be blocked — non-fatal */
    }
  }

  function setStatus(isConnected, detail) {
    connected = isConnected;
    const dot = document.getElementById("conn-dot");
    const label = document.getElementById("conn-label");
    if (dot) dot.className = "dot " + (isConnected ? "connected" : "disconnected");
    if (label) label.textContent = detail;
  }

  function injectForm() {
    if (document.getElementById("autopus-connect-form")) return;
    const wrap = document.createElement("div");
    wrap.id = "autopus-connect-form";
    wrap.style.cssText =
      "display:flex;gap:6px;align-items:center;margin:8px 0;font-family:sans-serif;";
    const input = document.createElement("input");
    input.id = "autopus-channel-input";
    input.type = "text";
    input.placeholder = "channel secret";
    input.value = readStored();
    input.style.cssText = "flex:1;min-width:0;padding:4px 6px;font-size:12px;";
    const btn = document.createElement("button");
    btn.id = "autopus-connect-btn";
    btn.textContent = "Connect";
    btn.style.cssText = "padding:4px 10px;font-size:12px;cursor:pointer;";
    btn.addEventListener("click", function () {
      const v = (input.value || "").trim();
      if (!v) {
        setStatus(false, "Enter the channel secret");
        return;
      }
      writeStored(v);
      channel = v;
      connect();
    });
    wrap.appendChild(input);
    wrap.appendChild(btn);
    (document.body || document.documentElement).appendChild(wrap);
  }

  function sendToFigma(message) {
    parent.postMessage({ pluginMessage: message, pluginId: "*" }, "*");
  }

  function reply(id, body) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        id: id,
        type: "message",
        channel: channel,
        message: Object.assign({ id: id }, body),
      }),
    );
  }

  function connect() {
    if (!channel) {
      setStatus(false, "Enter the channel secret");
      return;
    }
    setStatus(false, "Connecting…");
    try {
      ws = new WebSocket(URL_WS);
    } catch (e) {
      setStatus(false, "Relay unreachable — retrying");
      setTimeout(connect, 2000);
      return;
    }
    ws.onopen = function () {
      ws.send(
        JSON.stringify({ id: "join-" + Date.now(), type: "join", channel: channel }),
      );
    };
    ws.onmessage = function (event) {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!data || typeof data !== "object") return;
      if (data.type === "system") {
        const m = data.message;
        if (typeof m === "string" && m.indexOf("Joined channel") === 0) {
          setStatus(true, "Connected · channel ok");
        }
        return;
      }
      if (data.type === "error") {
        // Relay rejected the channel (C-1 unauthorized) or a bad envelope.
        // Stop here — do not auto-reconnect with a known-bad secret.
        setStatus(false, "Channel rejected — check the secret");
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
      const wasConnected = connected;
      setStatus(false, "Disconnected");
      // Only auto-reconnect if the channel had worked — avoids hammering the
      // relay with a rejected secret in a tight loop.
      if (wasConnected) setTimeout(connect, 2000);
    };
    ws.onerror = function () {
      /* let onclose drive reconnect */
    };
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

  injectForm();
  const urlChannel = params.get("channel");
  if (urlChannel) {
    channel = urlChannel;
    const inp = document.getElementById("autopus-channel-input");
    if (inp) inp.value = urlChannel;
    connect(); // advanced/CI: ?channel=<secret> auto-connects
  } else {
    setStatus(false, "Enter the channel secret to connect");
  }
})();
