// SPEC-FIGMA-013 T14 / AC-HTTP-9 — Phase 1.5 RED scaffold.
// Maps to: REQ-10.
// Graceful shutdown on SIGTERM ≤ 2.0s wall time + audit flushed +
// new TCP connect attempts after signal return ECONNREFUSED.
//
// Uses child_process.spawn against ./dist/src/daemon/mcp-http-entry.js
// (NOT the in-process harness) — the SPEC observable is wall-time process
// exit on a real OS signal.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface ListeningEvent {
  event: "http_listening";
  port: number;
  address: string;
}

let workDir: string;
let child: ChildProcess | null = null;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fig013-AC-HTTP-9-"));
});

afterEach(() => {
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
  }
  child = null;
  rmSync(workDir, { recursive: true, force: true });
});

const ENTRY = "./dist/src/daemon/mcp-http-entry.js";

async function spawnEntryAndWaitListening(): Promise<{
  proc: ChildProcess;
  port: number;
}> {
  const proc = spawn("node", [ENTRY], {
    env: { ...process.env, AUTOPUS_AUDIT_DIR: workDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdoutBuf = "";
    const onData = (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      const lines = stdoutBuf.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as ListeningEvent;
          if (ev.event === "http_listening" && typeof ev.port === "number") {
            proc.stdout?.off("data", onData);
            resolve({ proc, port: ev.port });
            return;
          }
        } catch {
          // not a JSON line yet — continue accumulating
        }
      }
    };
    proc.stdout?.on("data", onData);
    proc.once("exit", (code) => {
      reject(new Error(`process exited before listening (code=${code})`));
    });
    setTimeout(() => reject(new Error("timeout waiting for http_listening")), 5000); // @AX:NOTE: [AUTO] Startup wait is separate from the SIGTERM 2s shutdown SLA.
  });
}

// @AX:ANCHOR: [AUTO] SIGTERM shutdown is a process-level HTTP daemon contract.
// @AX:REASON: [AUTO] It verifies wall-clock exit, socket refusal, and audit flush outside the in-process harness.
describe("AC-HTTP-9: graceful shutdown on SIGTERM ≤ 2.0s + audit flushed", () => {
  it("SIGTERM → exit 0 in ≤ 2000ms; new TCP connect returns ECONNREFUSED; audit row present", async () => {
    const { proc, port } = await spawnEntryAndWaitListening();
    child = proc;
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    const client = new Client(
      { name: "shutdown-test", version: "0.0.1" },
      { capabilities: {} },
    );
    await client.connect(transport);
    const dryRunResp = await client.callTool({
      name: "dryRun",
      arguments: { frame_id: "F-SHUTDOWN", write_target: "annotation_card" },
    });
    const pending = JSON.parse(
      (dryRunResp.content as Array<{ type: string; text: string }>)[0].text,
    ) as { pending_id: string; source_hash_dryrun: string };
    const applyResp = await client.callTool({
      name: "apply",
      arguments: {
        pending_id: pending.pending_id,
        source_hash_recomputed: pending.source_hash_dryrun,
      },
    });
    expect(applyResp.isError).toBe(true);

    const t0 = Date.now();
    proc.kill("SIGTERM");

    const exited = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      proc.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const elapsed = Date.now() - t0;

    if (process.platform === "win32") {
      expect(exited.code === 0 || exited.signal === "SIGTERM").toBe(true);
    } else {
      expect(exited.code).toBe(0);
    }
    expect(elapsed).toBeLessThanOrEqual(2000);

    // New TCP connect must fail with ECONNREFUSED.
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        reject(new Error("expected ECONNREFUSED but connect succeeded"));
      });
      sock.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ECONNREFUSED") {
          resolve();
        } else {
          reject(new Error(`expected ECONNREFUSED, got ${err.code}`));
        }
      });
    });

    // Audit file should exist and contain at least one row after flush.
    const auditPath = join(workDir, "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const writeAuditPath = join(workDir, "write-audit.jsonl");
    expect(existsSync(writeAuditPath)).toBe(true);
    const writeRows = readFileSync(writeAuditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { reason?: string });
    expect(
      writeRows.some((row) => row.reason === "APPLY_PARTIAL_DISCONNECT"),
    ).toBe(true);
  });
});
