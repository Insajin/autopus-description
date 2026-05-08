#!/usr/bin/env node
// SPEC-FIGMA-003 T12 CLI: read frame_meta inputs, generate descriptions,
// write a description-manifest.json. Wraps runBatch and pipes captured
// stdout/stderr to the actual process streams.

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { runBatch } from "../batch-executor.js";
import { MockLLMProvider } from "../providers/mock-provider.js";
import { AnthropicClaudeAdapter } from "../providers/anthropic-provider.js";
import { OpenAIResponsesAdapter } from "../providers/openai-provider.js";
import type { LLMProvider } from "../types/llm-provider.js";
import type { FrameInput } from "../routing.js";
import { isDirectInvocation } from "../direct-invocation.js";
import {
  PROJECT_BRIEF_HELP,
  handleProjectBriefInit,
  parseProjectBriefArg,
  projectBriefPathHasNull,
  resolveProjectBrief,
  type ProjectBriefArgs,
} from "./project-brief-cli.js";

const DEFAULT_OPENAI_MODEL = "gpt-5.5";
// SPEC-FIGMA-005 REQ-30 enabler — sync default sonnet 4.6, escalate to opus 4.7.
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ESCALATED_ANTHROPIC_MODEL = "claude-opus-4-7";

const HELP = `Usage: generate-descriptions <input-dir> <output-manifest>

Generate frame descriptions for SPEC-FIGMA-002 inputs.

Options:
  --parallelism=N       max concurrent LLM calls (default 5)
  --temperature=N       LLM temperature (default 0)
  --mode=node-only|auto routing mode (default auto)
  --audit-dir=PATH      audit JSONL output directory (default .audit)
  --provider=mock|anthropic|openai provider adapter (default mock)
                        anthropic uses ANTHROPIC_API_KEY; openai uses
                        OPENAI_API_KEY (Responses API, default gpt-5.5).
${PROJECT_BRIEF_HELP}
  --model=ID            pinned LLM model id (default claude-sonnet-4-6
                        for anthropic, gpt-5.5 for openai)
  --batch               submit via Anthropic Message Batches API (50% cost,
                        24h SLA). SPEC-FIGMA-005 REQ-05.
  --realtime            force synchronous messages.create path (default).
                        SPEC-FIGMA-005 REQ-06.
  --escalate-model      use claude-opus-4-7 instead of claude-sonnet-4-6 for
                        anthropic provider (SPEC-FIGMA-005 REQ-30).
  --help, -h            show this help and exit 0
`;

interface ParsedArgs extends ProjectBriefArgs {
  help: boolean;
  input?: string;
  output?: string;
  parallelism?: number;
  temperature?: number;
  mode?: "node-only" | "auto";
  audit_dir?: string;
  provider?: "mock" | "anthropic" | "openai";
  model?: string;
  lane?: "realtime" | "batch";
  escalate_model?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false };
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg.startsWith("--parallelism=")) {
      out.parallelism = Number(arg.slice("--parallelism=".length));
      continue;
    }
    if (arg.startsWith("--temperature=")) {
      out.temperature = Number(arg.slice("--temperature=".length));
      continue;
    }
    if (arg.startsWith("--mode=")) {
      const v = arg.slice("--mode=".length);
      if (v === "node-only" || v === "auto") out.mode = v;
      continue;
    }
    if (arg.startsWith("--audit-dir=")) {
      out.audit_dir = arg.slice("--audit-dir=".length);
      continue;
    }
    if (arg.startsWith("--provider=")) {
      const v = arg.slice("--provider=".length);
      if (v === "mock" || v === "anthropic" || v === "openai") out.provider = v;
      continue;
    }
    if (parseProjectBriefArg(arg, out)) continue;
    if (arg.startsWith("--model=")) {
      out.model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--batch") {
      out.lane = "batch";
      continue;
    }
    if (arg === "--realtime") {
      out.lane = "realtime";
      continue;
    }
    if (arg === "--escalate-model") {
      out.escalate_model = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }
  if (positional.length >= 1) out.input = positional[0];
  if (positional.length >= 2) out.output = positional[1];
  return out;
}

// SEC-M1: ensure `target` resolves underneath `root` and is not a symlink.
// A hostile fixture could symlink screenshot.png to /etc/passwd; an
// unguarded read would base64-encode the bytes into the LLM API request,
// leaking confidential data on multi-tenant boxes.
function assertContainedFile(root: string, target: string): void {
  const rootAbs = resolve(root);
  const rel = relative(rootAbs, target);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`refused: path escapes input dir: ${target}`);
  }
  if (existsSync(target)) {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink()) {
      throw new Error(`refused: symlink not allowed: ${target}`);
    }
  }
}

function loadFrames(inputDir: string): FrameInput[] {
  // Each subdirectory of inputDir corresponds to a frame: directory name is
  // the screen_id. Inside: response.json (mock-provider format) +
  // screenshot.png (optional). frame_meta.json supplies the structural
  // metadata; if absent, fall back to a minimal shell.
  const frames: FrameInput[] = [];
  const inputAbs = resolve(inputDir);
  for (const entry of readdirSync(inputAbs)) {
    const dir = join(inputAbs, entry);
    if (!statSync(dir).isDirectory()) continue;
    const screen_id = entry;
    const metaPath = join(dir, "frame_meta.json");
    if (existsSync(metaPath)) assertContainedFile(inputAbs, metaPath);
    const meta = existsSync(metaPath)
      ? (JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>)
      : { screen_id, name: screen_id };
    const screenshot_path = join(dir, "screenshot.png");
    assertContainedFile(inputAbs, screenshot_path);
    frames.push({
      screen_id,
      source_hash:
        typeof (meta as { source_hash?: unknown }).source_hash === "string"
          ? (meta as { source_hash: string }).source_hash
          : "0000000000000000",
      frame_meta: { screen_id, ...meta } as FrameInput["frame_meta"],
      screenshot_path,
    });
  }
  frames.sort((a, b) => (a.screen_id < b.screen_id ? -1 : 1));
  return frames;
}

function buildProvider(args: ParsedArgs, inputDir: string): LLMProvider {
  if (args.provider === "anthropic") {
    return new AnthropicClaudeAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  if (args.provider === "openai") {
    return new OpenAIResponsesAdapter({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return new MockLLMProvider({
    responses: new Map(),
    useFixtureDir: inputDir,
  });
}

// Fallback model when no --model is provided. Exposed for the unit test
// that pins per-provider defaults.
// SPEC-FIGMA-005 REQ-30: anthropic default is sonnet-4-6; --escalate-model
// upgrades to opus-4-7.
export function defaultModelFor(
  provider: ParsedArgs["provider"],
  escalate?: boolean,
): string | undefined {
  if (provider === "openai") return DEFAULT_OPENAI_MODEL;
  if (provider === "anthropic") {
    return escalate ? ESCALATED_ANTHROPIC_MODEL : DEFAULT_ANTHROPIC_MODEL;
  }
  return undefined;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (projectBriefPathHasNull(args)) {
    process.stderr.write("error: null byte in path argument\n");
    return 2;
  }
  if (await handleProjectBriefInit(args)) return 0;
  if (!args.input || !args.output) {
    process.stderr.write("error: missing arguments\n");
    process.stderr.write(HELP);
    return 2;
  }
  // SEC-M1: reject null-byte path injection before passing to fs.
  if (
    args.input.includes("\0") ||
    args.output.includes("\0") ||
    projectBriefPathHasNull(args)
  ) {
    process.stderr.write("error: null byte in path argument\n");
    return 2;
  }
  const projectBrief = await resolveProjectBrief(args);
  if (projectBrief === 2) return 2;
  const inputDir = resolve(args.input);
  if (!existsSync(inputDir)) {
    process.stderr.write(`error: input directory not found: ${inputDir}\n`);
    return 2;
  }
  let frames;
  try {
    frames = loadFrames(inputDir);
  } catch (err) {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  const provider = buildProvider(args, inputDir);
  const result = await runBatch({
    frames,
    provider,
    output: resolve(args.output),
    parallelism: args.parallelism,
    temperature: args.temperature,
    mode: args.mode,
    audit_dir: args.audit_dir,
    model_id: args.model ?? defaultModelFor(args.provider, args.escalate_model),
    lane: args.lane,
    project_brief: projectBrief,
  });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exit_code;
}

// Direct execution entry point.
if (isDirectInvocation(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
