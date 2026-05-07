// SPEC-FIGMA-006 REQ-01, AC-S5: Autopus daemon CLI (start | stop | status).
//
// In-process invocation surface — `runDaemonCli(argv, {cwd})` returns the
// stdout/stderr buffers and exit code. Persists daemon state across calls
// via `<cwd>/.autopus/daemon.pid` and `<cwd>/.autopus/daemon-state.json`.
// On `start`, prints exactly one structured `booted` JSON line to stdout
// matching the SPEC regex (REQ-01).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface RunCliOptions {
  cwd: string;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface DaemonState {
  pid: number;
  transport: "stdio" | "http" | "tunnel";
  port: number;
  session_token: string;
  booted_at: number;
}

// On-disk state shape — session_token is intentionally omitted from disk
// persistence. The token is an ephemeral WebSocket auth secret printed once
// to stdout per REQ-14; persisting it to .autopus/daemon-state.json would
// extend its lifetime past the daemon process and create a Q-SEC-02 leak
// surface (token survives SIGKILL on disk). cmdStatus does not return the
// token either, so the field has no on-disk consumer.
type PersistedState = Omit<DaemonState, "session_token">;

function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string>;
} {
  const command = argv[0] ?? "";
  const flags: Record<string, string> = {};
  for (const a of argv.slice(1)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) flags[m[1]] = m[2];
  }
  return { command, flags };
}

function autopusDir(cwd: string): string {
  return join(cwd, ".autopus");
}

function pidPath(cwd: string): string {
  return join(autopusDir(cwd), "daemon.pid");
}

function statePath(cwd: string): string {
  return join(autopusDir(cwd), "daemon-state.json");
}

// @AX:NOTE: [AUTO] session_token contract — must match REQ-01 regex /^[A-Za-z0-9_-]{32,}$/; bridge.ts re-validates with the same pattern.
// @AX:WARN: [AUTO] security-sensitive surface — token gates daemon WebSocket auth (REQ-02/REQ-14). @AX:REASON: weakening entropy or charset would let unauthenticated clients connect.
function generateSessionToken(): string {
  // 24 random bytes -> 32 chars base64url, matches /^[A-Za-z0-9_-]{32,}$/.
  return randomBytes(24).toString("base64url");
}

async function cmdStart(opts: RunCliOptions, flags: Record<string, string>): Promise<RunCliResult> {
  const transport = (flags.transport as DaemonState["transport"]) || "stdio";
  const port = parseInt(flags.port ?? "0", 10);
  const dir = autopusDir(opts.cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const state: DaemonState = {
    pid: process.pid,
    transport,
    port,
    session_token: generateSessionToken(),
    booted_at: Date.now(),
  };
  writeFileSync(pidPath(opts.cwd), String(state.pid), "utf8");
  // Persist everything EXCEPT session_token (Q-SEC-02 — see PersistedState).
  const persisted: PersistedState = {
    pid: state.pid,
    transport: state.transport,
    port: state.port,
    booted_at: state.booted_at,
  };
  writeFileSync(statePath(opts.cwd), JSON.stringify(persisted), "utf8");
  // @AX:NOTE: [AUTO] booted JSON shape is contract-frozen — key order and quoting are asserted by REQ-01 regex; do not switch to JSON.stringify without re-running AC-S5.
  // SPEC-FIGMA-006 REQ-01 regex requires this exact key order:
  // {"event":"booted","pid":N,"transport":"stdio","port":N,"session_token":"…"}
  const booted = `{"event":"booted","pid":${state.pid},"transport":"${state.transport}","port":${state.port},"session_token":"${state.session_token}"}`;
  return { stdout: booted + "\n", stderr: "", exitCode: 0 };
}

async function cmdStatus(opts: RunCliOptions): Promise<RunCliResult> {
  const sp = statePath(opts.cwd);
  const pp = pidPath(opts.cwd);
  if (!existsSync(pp) || !existsSync(sp)) {
    return { stdout: "", stderr: "daemon not running\n", exitCode: 1 };
  }
  const state = JSON.parse(readFileSync(sp, "utf8")) as PersistedState;
  const snapshot = {
    connected_clients: 0,
    last_selection_event_at: null as string | null,
    pid: state.pid,
    port: state.port,
    transport: state.transport,
    uptime_ms: Math.max(0, Date.now() - state.booted_at),
  };
  return { stdout: JSON.stringify(snapshot) + "\n", stderr: "", exitCode: 0 };
}

async function cmdStop(opts: RunCliOptions): Promise<RunCliResult> {
  const pp = pidPath(opts.cwd);
  const sp = statePath(opts.cwd);
  if (existsSync(pp)) rmSync(pp, { force: true });
  if (existsSync(sp)) rmSync(sp, { force: true });
  return { stdout: "", stderr: "", exitCode: 0 };
}

export async function runDaemonCli(argv: string[], opts: RunCliOptions): Promise<RunCliResult> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "start":
      return cmdStart(opts, flags);
    case "status":
      return cmdStatus(opts);
    case "stop":
      return cmdStop(opts);
    default:
      return {
        stdout: "",
        stderr: `unknown command: ${command}\n`,
        exitCode: 2,
      };
  }
}

// Direct CLI entry point (npm bin).
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  runDaemonCli(argv, { cwd: process.cwd() }).then((r) => {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.exitCode);
  });
}
