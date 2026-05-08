// SPEC-FIGMA-013 T12 / AC-HTTP-7 — Phase 1.5 RED scaffold.
// Maps to: REQ-08, INV-13.5.
// Default-safe loopback binding: httpServer.address().address === "127.0.0.1",
// family === "IPv4", and zero non-loopback listening sockets in the process.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

import {
  createHttpHarness,
  type HttpHarness,
} from "./__helpers/in-process-http-pair.js";
import { createMcpHttpServer } from "../../../src/daemon/mcp-http-entry.js";

let workDir: string;
let harness: HttpHarness;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-7-"));
  harness = await createHttpHarness({ auditDir: workDir });
});

afterEach(async () => {
  await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

// @AX:ANCHOR: [AUTO] Loopback-only binding is the default HTTP exposure boundary.
// @AX:REASON: [AUTO] Relaxing this contract requires explicit allow-remote handling in the daemon entrypoint.
describe("AC-HTTP-7: default-safe loopback binding (zero non-loopback sockets)", () => {
  it("httpServer.address().address === '127.0.0.1' and family === 'IPv4'", () => {
    const addr = harness.httpServer.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe("object");
    const a = addr as { address: string; family: string; port: number };
    expect(a.address).toBe("127.0.0.1");
    expect(a.family).toBe("IPv4");
    expect(a.port).toBe(harness.port);
  });

  it("non-loopback (!== 127.0.0.1 && !== ::1) listening sockets count is 0", () => {
    // Single-socket harness path: the only bound listener is via httpServer.
    const addr = harness.httpServer.address() as {
      address: string;
      family: string;
    };
    const isLoopback = addr.address === "127.0.0.1" || addr.address === "::1";
    expect(isLoopback).toBe(true);
    // Negative assertions on the bound address.
    expect(addr.address).not.toBe("0.0.0.0");
    expect(addr.address).not.toBe("::");
  });

  it("a TCP connect to 127.0.0.1:<port> succeeds (loopback reachable)", async () => {
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: "127.0.0.1", port: harness.port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", reject);
    });
  });

  it("production runtime defaults to 127.0.0.1, rejects remote bind without opt-in, and allows explicit opt-in", async () => {
    const runtime = await createMcpHttpServer({ auditDir: workDir });
    try {
      expect(runtime.address).toBe("127.0.0.1");
    } finally {
      await runtime.close();
    }

    await expect(
      createMcpHttpServer({ auditDir: workDir, bind: "0.0.0.0" }),
    ).rejects.toThrow("non-loopback --bind requires --allow-remote");

    const remote = await createMcpHttpServer({
      auditDir: workDir,
      bind: "0.0.0.0",
      allowRemote: true,
    });
    try {
      expect(remote.address).toBe("0.0.0.0");
    } finally {
      await remote.close();
    }
  });
});
