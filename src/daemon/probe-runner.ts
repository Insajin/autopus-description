// SPEC-FIGMA-008 REQ-09 / REQ-10 / REQ-16 — Probe runner for codex-windows and
// claude-cowork transport matrix verification.
//
// Appends one JSONL row per call to `<auditDir>/probes/transport-matrix.jsonl`
// with the key sets defined by AC-T10 oracle. Status enum: verified | unverified
// | failed. error_text_redacted passes through `redact` + `redactTunnelUrl`.
// The cowork probe wraps the doc body via `wrapUntrustedFigmaText` (untrusted
// prompt evidence) before slicing to ≤2000 chars.
//
// Never throws on IO errors — failure modes write a status:"failed" row.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { redact, redactTunnelUrl } from "../token-redactor.js";
import { wrapUntrustedFigmaText } from "../prompts/untrusted-fence.js";

export type ProbeTarget = "codex-windows" | "claude-cowork";
export type ProbeStatus = "verified" | "unverified" | "failed";

export interface ProbeRow {
  probe_target: ProbeTarget;
  started_at: string;
  finished_at: string;
  status: ProbeStatus;
  mcp_protocol_version: number;
  capabilities_advertised: string[];
  error_text_redacted: string;
  doc_excerpt?: string;
}

export interface ProbeRunnerDeps {
  readonly fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  readonly clock?: () => number;
}

// Accepts BOTH the Phase 1.5 test contract (`target`, `outPath`) AND the
// extended spec contract (`probeTarget`, `jsonlPath`, `deps`). At least one of
// each pair must resolve.
export interface RunProbeInput {
  readonly target?: ProbeTarget;
  readonly probeTarget?: ProbeTarget;
  readonly configPath: string;
  readonly outPath?: string;
  readonly jsonlPath?: string;
  readonly injectError?: string;
  readonly fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  readonly clock?: () => number;
  readonly deps?: ProbeRunnerDeps;
}

interface ProbeConfig {
  codex_windows_binary_path?: string;
  cowork_doc_url?: string;
}

const COWORK_DOC_EXCERPT_MAX = 2000;

export async function runProbe(input: RunProbeInput): Promise<void> {
  await runProbeAndReturnRow(input);
}

// Internal: same logic but returns the appended row so daemon callers
// (server-tunnel-extension) can act on it without re-reading the JSONL.
export async function runProbeAndReturnRow(input: RunProbeInput): Promise<ProbeRow> {
  const target: ProbeTarget = (input.target ?? input.probeTarget) as ProbeTarget;
  const outPath = input.outPath ?? input.jsonlPath;
  if (!target) throw new Error("runProbe: target/probeTarget required");
  if (!outPath) throw new Error("runProbe: outPath/jsonlPath required");
  const clock = input.clock ?? input.deps?.clock ?? (() => Date.now());
  const fetchFn = input.fetchFn ?? input.deps?.fetchFn;
  const startedAt = new Date(clock()).toISOString();
  let row: Record<string, unknown>;
  try {
    const config = loadConfig(input.configPath);
    if (target === "codex-windows") {
      row = await runCodexProbe(config, startedAt, clock, input.injectError);
    } else {
      row = await runCoworkProbe(config, startedAt, clock, fetchFn, input.injectError);
    }
  } catch (err) {
    row = buildFailedRow(target, startedAt, clock, errorMessage(err));
  }
  appendRow(outPath, row);
  return row as unknown as ProbeRow;
}

function loadConfig(configPath: string): ProbeConfig {
  if (!existsSync(configPath)) {
    throw new Error(`probe config missing: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as ProbeConfig;
}

async function runCodexProbe(
  config: ProbeConfig,
  startedAt: string,
  clock: () => number,
  injectError?: string,
): Promise<Record<string, unknown>> {
  const binaryPath = config.codex_windows_binary_path ?? "";
  const finishedAt = new Date(clock()).toISOString();
  if (injectError) {
    return {
      capabilities_advertised: [],
      error_text_redacted: redactBoth(injectError),
      finished_at: finishedAt,
      mcp_protocol_version: 0,
      probe_target: "codex-windows",
      started_at: startedAt,
      status: "failed" as ProbeStatus,
    };
  }
  // Real Codex stdio probe is gated by binary existence; absent path → unverified.
  const status: ProbeStatus = binaryPath && existsSync(binaryPath) ? "verified" : "unverified";
  const errorText = status === "unverified" ? `binary not found: ${binaryPath}` : "";
  return {
    capabilities_advertised: status === "verified" ? ["resources.read", "tools.call"] : [],
    error_text_redacted: redactBoth(errorText),
    finished_at: finishedAt,
    mcp_protocol_version: status === "verified" ? 1 : 0,
    probe_target: "codex-windows",
    started_at: startedAt,
    status,
  };
}

async function runCoworkProbe(
  config: ProbeConfig,
  startedAt: string,
  clock: () => number,
  fetchFn: RunProbeInput["fetchFn"],
  injectError?: string,
): Promise<Record<string, unknown>> {
  const docUrl = config.cowork_doc_url ?? "";
  let docText = "";
  let status: ProbeStatus = "unverified";
  let errorText = injectError ?? "";
  if (!injectError && docUrl) {
    try {
      const fetcher = fetchFn ?? defaultFetch;
      const res = await fetcher(docUrl);
      if (res.ok) {
        docText = await res.text();
        status = "verified";
      } else {
        errorText = `cowork doc fetch failed: HTTP ${res.status}`;
        status = "failed";
      }
    } catch (e) {
      errorText = `cowork doc fetch error: ${errorMessage(e)}`;
      status = "failed";
    }
  } else if (!docUrl) {
    errorText = "cowork doc url not configured";
  }
  // Wrap as untrusted prompt evidence, then redact, then slice.
  const wrappedExcerpt = docText
    ? wrapUntrustedFigmaText({ kind: "node_description", content: docText })
    : "";
  const docExcerpt = redactBoth(wrappedExcerpt).slice(0, COWORK_DOC_EXCERPT_MAX);
  return {
    capabilities_advertised:
      status === "verified" ? ["resources.read", "tools.call", "fallback.polling"] : [],
    doc_excerpt: docExcerpt,
    error_text_redacted: redactBoth(errorText),
    finished_at: new Date(clock()).toISOString(),
    mcp_protocol_version: status === "verified" ? 1 : 0,
    probe_target: "claude-cowork",
    started_at: startedAt,
    status,
  };
}

function buildFailedRow(
  target: ProbeTarget,
  startedAt: string,
  clock: () => number,
  errorText: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    capabilities_advertised: [],
    error_text_redacted: redactBoth(errorText),
    finished_at: new Date(clock()).toISOString(),
    mcp_protocol_version: 0,
    probe_target: target,
    started_at: startedAt,
    status: "failed" as ProbeStatus,
  };
  if (target === "claude-cowork") base.doc_excerpt = "";
  return base;
}

function appendRow(outPath: string, row: Record<string, unknown>): void {
  try {
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(outPath, JSON.stringify(row) + "\n", "utf8");
  } catch {
    // IO failure is itself logged elsewhere; never throw from the probe runner.
  }
}

function redactBoth(text: string): string {
  return redactTunnelUrl(redact(text));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const defaultFetch: NonNullable<RunProbeInput["fetchFn"]> = async (url) => {
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
  };
};
