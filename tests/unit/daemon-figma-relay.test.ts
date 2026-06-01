// SPEC-FIGMA-017 Phase 2 — FigmaRelay + FigmaPluginClient roundtrip tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";

import { FigmaRelay } from "../../src/daemon/figma-relay.js";
import { FigmaPluginClient } from "../../src/daemon/figma-plugin-client.js";

// Pick a port unlikely to collide with a real Figma plugin in dev.
const TEST_PORT = 3955;
const TEST_URL = `ws://127.0.0.1:${TEST_PORT}`;

let relay: FigmaRelay;

beforeEach(async () => {
  relay = new FigmaRelay({ port: TEST_PORT });
  await relay.start();
});

afterEach(async () => {
  await relay.stop();
});

describe("FigmaRelay protocol", () => {
  it("starts and reports zero stats", () => {
    const stats = relay.stats();
    expect(stats.channels).toBe(0);
    expect(stats.clients).toBe(0);
  });

  it("rejects non-JSON messages with type:error", async () => {
    const errors: unknown[] = [];
    const ws = new WebSocket(TEST_URL);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.type === "error") errors.push(msg.message);
    });
    ws.send("not json");
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toContain("invalid JSON");
    ws.close();
  });

  it("requires channel name on join", async () => {
    const errors: unknown[] = [];
    const ws = new WebSocket(TEST_URL);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.type === "error") errors.push(msg.message);
    });
    ws.send(JSON.stringify({ type: "join" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toContain("Channel name is required");
    ws.close();
  });

  it("two clients in same channel can broadcast (sender excluded)", async () => {
    const a = new WebSocket(TEST_URL);
    const b = new WebSocket(TEST_URL);
    await Promise.all([
      new Promise<void>((r) => a.once("open", r)),
      new Promise<void>((r) => b.once("open", r)),
    ]);

    a.send(JSON.stringify({ id: "j1", type: "join", channel: "test" }));
    b.send(JSON.stringify({ id: "j2", type: "join", channel: "test" }));
    await new Promise((r) => setTimeout(r, 80));

    const aMessages: unknown[] = [];
    const bMessages: unknown[] = [];
    a.on("message", (d) => aMessages.push(JSON.parse(d.toString())));
    b.on("message", (d) => bMessages.push(JSON.parse(d.toString())));

    a.send(
      JSON.stringify({
        id: "m1",
        type: "message",
        channel: "test",
        message: { id: "m1", command: "ping" },
      }),
    );
    await new Promise((r) => setTimeout(r, 60));

    const bGotBroadcast = bMessages.some(
      (m) => (m as { type?: string }).type === "broadcast",
    );
    const aGotEcho = aMessages.some(
      (m) => (m as { type?: string }).type === "broadcast",
    );
    expect(bGotBroadcast).toBe(true);
    expect(aGotEcho).toBe(false);

    a.close();
    b.close();
  });

  it("rejects a join whose channel is not the configured secret (C-1)", async () => {
    const secret = "s3cr3t-channel-c1";
    const guarded = new FigmaRelay({
      port: TEST_PORT + 1,
      allowedChannel: secret,
    });
    await guarded.start();
    const url = `ws://127.0.0.1:${TEST_PORT + 1}`;
    try {
      // Wrong channel → "Channel not authorized" + socket closed, no membership.
      const bad = new WebSocket(url);
      const badMsgs: Array<{ type?: string; message?: unknown }> = [];
      await new Promise<void>((r) => bad.once("open", () => r()));
      bad.on("message", (d) => badMsgs.push(JSON.parse(d.toString())));
      const badClosed = new Promise<void>((r) => bad.once("close", () => r()));
      bad.send(JSON.stringify({ type: "join", channel: "autopus" }));
      await badClosed;
      expect(
        badMsgs.some(
          (m) => m.type === "error" && m.message === "Channel not authorized",
        ),
      ).toBe(true);
      expect(guarded.stats().channels).toBe(0);

      // Correct secret → joined.
      const good = new WebSocket(url);
      const goodMsgs: Array<{ type?: string; message?: unknown }> = [];
      await new Promise<void>((r) => good.once("open", () => r()));
      good.on("message", (d) => goodMsgs.push(JSON.parse(d.toString())));
      good.send(JSON.stringify({ type: "join", channel: secret }));
      await new Promise((r) => setTimeout(r, 60));
      expect(
        goodMsgs.some(
          (m) =>
            m.type === "system" &&
            typeof m.message === "string" &&
            (m.message as string).indexOf("Joined channel") === 0,
        ),
      ).toBe(true);
      good.close();
    } finally {
      await guarded.stop();
    }
  });

  it("FigmaPluginClient connects, joins, and roundtrips a command", async () => {
    // Spawn a "fake plugin" peer that listens for messages and replies.
    const fakePlugin = new WebSocket(TEST_URL);
    await new Promise<void>((r) => fakePlugin.once("open", r));
    fakePlugin.send(
      JSON.stringify({ id: "fp-join", type: "join", channel: "ch-1" }),
    );
    await new Promise((r) => setTimeout(r, 80));

    fakePlugin.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== "broadcast") return;
        const inner = msg.message;
        // Echo back as a result message.
        fakePlugin.send(
          JSON.stringify({
            id: inner.id,
            type: "message",
            channel: "ch-1",
            message: { id: inner.id, result: { ok: true, echo: inner.command } },
          }),
        );
      } catch {
        /* ignore */
      }
    });

    const client = new FigmaPluginClient({
      url: TEST_URL,
      channel: "ch-1",
      timeoutMs: 3000,
    });
    await client.connect();
    expect(client.isReady()).toBe(true);

    const result = (await client.sendCommand("get_document_info", {})) as {
      ok: boolean;
      echo: string;
    };
    expect(result.ok).toBe(true);
    expect(result.echo).toBe("get_document_info");

    await client.close();
    fakePlugin.close();
  });
});
