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

  var LANG_KEY = "autopus.description.language";
  function readStoredLang() {
    try {
      return window.localStorage.getItem(LANG_KEY) || "ko";
    } catch (_) {
      return "ko";
    }
  }
  function writeStoredLang(v) {
    try {
      window.localStorage.setItem(LANG_KEY, v);
    } catch (_) {
      /* non-fatal */
    }
  }
  // Tell the daemon which language to generate descriptions in.
  function sendLanguage(lang) {
    if (!ws || ws.readyState !== 1) return;
    var id = "lang-" + Date.now();
    ws.send(
      JSON.stringify({
        id: id,
        type: "message",
        channel: channel,
        message: {
          id: id,
          command: "set_description_language",
          params: { language: lang },
        },
      }),
    );
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

    // Description language selector — pushed to the daemon (used by generation).
    if (!document.getElementById("autopus-lang-row")) {
      const langRow = document.createElement("div");
      langRow.id = "autopus-lang-row";
      langRow.style.cssText =
        "display:flex;gap:6px;align-items:center;margin:0 0 6px;font-family:sans-serif;font-size:12px;color:#444;";
      const langLabel = document.createElement("span");
      langLabel.textContent = "Description language";
      const langSel = document.createElement("select");
      langSel.id = "autopus-lang-select";
      langSel.style.cssText = "padding:3px 6px;font-size:12px;";
      [["ko", "한국어"], ["en", "English"], ["ja", "日本語"], ["zh", "中文"]].forEach(
        function (o) {
          const opt = document.createElement("option");
          opt.value = o[0];
          opt.textContent = o[1];
          langSel.appendChild(opt);
        },
      );
      langSel.value = readStoredLang();
      langSel.addEventListener("change", function () {
        writeStoredLang(langSel.value);
        sendLanguage(langSel.value);
      });
      langRow.appendChild(langLabel);
      langRow.appendChild(langSel);
      (document.body || document.documentElement).appendChild(langRow);
    }

    // Onboarding hint: this plugin is a thin client to a local daemon, so a
    // fresh install does nothing until the daemon is running. Make that explicit
    // instead of looking broken.
    if (!document.getElementById("autopus-connect-help")) {
      const help = document.createElement("div");
      help.id = "autopus-connect-help";
      help.style.cssText =
        "margin:4px 0 8px;font-family:sans-serif;font-size:11px;color:#666;line-height:1.45;";
      help.textContent =
        "Requires the Autopus MCP daemon running locally " +
        "(npm i -g @autopus/figma-mcp). The daemon prints a per-session channel " +
        "secret — paste it above and click Connect. " +
        "Setup: github.com/Insajin/autopus-description";
      (document.body || document.documentElement).appendChild(help);
    }
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
      setStatus(false, "Couldn't open ws://localhost:3055 — is the daemon running?");
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
          // Sync the selected description language to the daemon on connect.
          sendLanguage(readStoredLang());
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
      if (wasConnected) {
        // A previously-working connection dropped (daemon restart, etc.).
        setStatus(false, "Disconnected — reconnecting…");
        setTimeout(connect, 2000);
      } else {
        // Never joined: the daemon isn't reachable on :3055. Don't loop — tell
        // the user to start it. (A wrong secret is handled by the error branch.)
        setStatus(
          false,
          "Couldn't reach the daemon on ws://localhost:3055 — start @autopus/figma-mcp, then Connect.",
        );
      }
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
