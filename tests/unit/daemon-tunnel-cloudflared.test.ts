/**
 * SPEC-FIGMA-008 Phase 3 — coverage tests for tunnel-cloudflared.ts.
 *
 * Targets the entire CloudflaredTunnelAdapter surface without spawning a real
 * cloudflared binary. We mock node:child_process.spawn to hand back a fake
 * ChildProcess that emits the expected URL chunk on stderr.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from "node:child_process";
import { CloudflaredTunnelAdapter } from "../../src/daemon/tunnel-cloudflared.js";

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

beforeEach(() => {
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CloudflaredTunnelAdapter (SPEC-FIGMA-008)", () => {
  it("attach() resolves with the URL parsed from stderr", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const promise = adapter.attach();
    queueMicrotask(() => {
      proc.stderr.emit(
        "data",
        Buffer.from("INF Visit https://abc-test.trycloudflare.com to access\n"),
      );
    });
    const result = await promise;
    expect(result.tunnelUrl).toBe("https://abc-test.trycloudflare.com");
  });

  it("attach() resolves with URL parsed from stdout", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const promise = adapter.attach();
    queueMicrotask(() => {
      proc.stdout.emit("data", Buffer.from("ready https://stdout-x.trycloudflare.com\n"));
    });
    const result = await promise;
    expect(result.tunnelUrl).toBe("https://stdout-x.trycloudflare.com");
  });

  it("attach() rejects with timeout error when no URL appears in time", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 50 });
    await expect(adapter.attach()).rejects.toThrow(/not received within timeout/);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("attach() rejects when the process exits before a URL is emitted", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const promise = adapter.attach();
    queueMicrotask(() => proc.emit("exit", 1));
    await expect(promise).rejects.toThrow(/exited before URL ready/);
  });

  it("attach() rejects when the process emits an error before URL", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const promise = adapter.attach();
    queueMicrotask(() => proc.emit("error", new Error("boom")));
    await expect(promise).rejects.toThrow(/boom/);
  });

  it("attach() throws when invoked twice (already attached)", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const p = adapter.attach();
    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from("https://x.trycloudflare.com"));
    });
    await p;
    await expect(adapter.attach()).rejects.toThrow(/already attached/);
  });

  it("detach() is a no-op when never attached", async () => {
    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080 });
    await expect(adapter.detach()).resolves.toBeUndefined();
  });

  it("detach() sends SIGTERM to the spawned process", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const p = adapter.attach();
    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from("https://x.trycloudflare.com"));
    });
    await p;

    await adapter.detach();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("detach() swallows kill errors (best-effort)", async () => {
    const proc = makeFakeProc();
    proc.kill = vi.fn(() => { throw new Error("kill failed"); });
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const p = adapter.attach();
    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from("https://x.trycloudflare.com"));
    });
    await p;
    await expect(adapter.detach()).resolves.toBeUndefined();
  });

  it("attach() rejects on exit when code is null (renders as '?')", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 500 });
    const promise = adapter.attach();
    queueMicrotask(() => proc.emit("exit", null));
    await expect(promise).rejects.toThrow(/exited before URL ready \(code=\?\)/);
  });

  it("attach() handles fakeProc with null stdout/stderr (optional-chain branch)", async () => {
    const proc = new EventEmitter() as FakeProc;
    // No stdout / no stderr — only emit error / exit events.
    proc.kill = vi.fn();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 50 });
    await expect(adapter.attach()).rejects.toThrow(/not received within timeout/);
  });

  it("attach() timeout swallows kill errors (best-effort kill)", async () => {
    const proc = makeFakeProc();
    proc.kill = vi.fn(() => { throw new Error("kill failed"); });
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const adapter = new CloudflaredTunnelAdapter({ localPort: 8080, spawnTimeoutMs: 50 });
    await expect(adapter.attach()).rejects.toThrow(/not received within timeout/);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses default binary path 'cloudflared' when not provided", async () => {
    const proc = makeFakeProc();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
    const adapter = new CloudflaredTunnelAdapter({ localPort: 4040, spawnTimeoutMs: 100 });
    const p = adapter.attach();
    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from("https://x.trycloudflare.com"));
    });
    await p;
    expect(spawn).toHaveBeenCalledWith(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4040"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });
});
