// SPEC-FIGMA-015 REQ-01 / REQ-02 / INV-BRIEF-PATH — Project brief MCP surface.
// Read tools: get_project_brief, validate_project_brief.
// Write tools: init_project_brief, update_project_brief.
//
// Path safety + parsing helpers live in `brief-path-guard.ts` to keep this
// dispatcher under the 300-line file limit.

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

import {
  loadProjectBrief,
  writeProjectBriefTemplate,
} from "../project-brief.js";
import { redact } from "../token-redactor.js";
import {
  assertBriefPath,
  parseBriefJson,
  findMissingRequired,
  BRIEF_REQUIRED_FIELDS,
} from "./brief-path-guard.js";
import type { ToolDescriptor } from "./mcp-stdio-handlers.js";
import type { ToolResponse } from "./mcp-stdio-write-handlers.js";

type Schema = ToolDescriptor["inputSchema"];

function schema(
  props: Record<string, { type: "string" | "object" }>,
  required: string[],
): Schema {
  return {
    type: "object",
    properties: props as unknown as Record<string, never>,
    additionalProperties: false,
    ...({ required } as object),
  } as unknown as Schema;
}

const INIT_SCHEMA = schema(
  { project_slug: { type: "string" }, output_path: { type: "string" } },
  ["project_slug"],
);
const UPDATE_SCHEMA = schema(
  { brief_path: { type: "string" }, patch: { type: "object" } },
  ["brief_path", "patch"],
);
const GET_SCHEMA = schema(
  { brief_path: { type: "string" }, project_slug: { type: "string" } },
  [],
);
const VALIDATE_SCHEMA = schema({ brief_path: { type: "string" } }, [
  "brief_path",
]);

export const BRIEF_READ_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "get_project_brief",
    description:
      "Load a project brief JSON by path or project_slug; one argument required.",
    inputSchema: GET_SCHEMA,
  }),
  Object.freeze({
    name: "validate_project_brief",
    description:
      "Check that a project brief satisfies the SPEC-FIGMA-003 required-content checklist.",
    inputSchema: VALIDATE_SCHEMA,
  }),
]);

export const BRIEF_WRITE_TOOLS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "init_project_brief",
    description:
      "Generate a project brief template under .autopus/runs/<slug>/ and return its path.",
    inputSchema: INIT_SCHEMA,
  }),
  Object.freeze({
    name: "update_project_brief",
    description:
      "Patch fields of an existing project brief in place; returns applied fields.",
    inputSchema: UPDATE_SCHEMA,
  }),
]);

export const BRIEF_READ_NAMES: ReadonlySet<string> = new Set(
  BRIEF_READ_TOOLS.map((t) => t.name),
);
export const BRIEF_WRITE_NAMES: ReadonlySet<string> = new Set(
  BRIEF_WRITE_TOOLS.map((t) => t.name),
);

function err(message: string): ToolResponse {
  return { content: [{ type: "text", text: redact(message) }], isError: true };
}

function ok(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: redact(JSON.stringify(payload)) }],
  };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface BriefContextOptions {
  readonly workspaceRoot: string;
}

export interface BriefReadContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

export interface BriefWriteContext {
  readonly tools: readonly ToolDescriptor[];
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
}

async function getBrief(
  opts: BriefContextOptions,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const brief_path = asString(args.brief_path);
  const project_slug = asString(args.project_slug);
  if (!brief_path && !project_slug) {
    return err("get_project_brief requires brief_path OR project_slug");
  }
  const candidate = brief_path
    ? brief_path
    : `.autopus/runs/${project_slug}/project-brief.json`;
  const gateErr = assertBriefPath(candidate, opts.workspaceRoot);
  if (gateErr) return err(gateErr);
  const resolved = resolve(opts.workspaceRoot, candidate);
  if (!existsSync(resolved)) {
    return ok({ error: "NOT_FOUND", path: candidate });
  }
  try {
    const brief = await loadProjectBrief(resolved);
    return ok({ brief, path: candidate });
  } catch (e) {
    return err(`load_project_brief failed: ${(e as Error).message}`);
  }
}

function validateBrief(
  opts: BriefContextOptions,
  args: Record<string, unknown>,
): ToolResponse {
  const brief_path = asString(args.brief_path);
  const gateErr = assertBriefPath(brief_path, opts.workspaceRoot);
  if (gateErr) return err(gateErr);
  const resolved = resolve(opts.workspaceRoot, brief_path);
  if (!existsSync(resolved)) {
    return ok({
      valid: false,
      missing_required: BRIEF_REQUIRED_FIELDS as string[],
      open_questions: [],
      error: "NOT_FOUND",
    });
  }
  try {
    const { parsed } = parseBriefJson(readFileSync(resolved, "utf8"));
    const missing = findMissingRequired(parsed);
    const openQuestions = Array.isArray(parsed.open_questions)
      ? (parsed.open_questions as string[])
      : [];
    return ok({
      valid: missing.length === 0,
      missing_required: missing,
      open_questions: openQuestions,
    });
  } catch (e) {
    return err(`validate_project_brief failed: ${(e as Error).message}`);
  }
}

async function initBrief(
  opts: BriefContextOptions,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const project_slug = asString(args.project_slug);
  if (!project_slug || /[^a-zA-Z0-9_\-]/.test(project_slug)) {
    return err("init_project_brief: project_slug must be [A-Za-z0-9_-]+");
  }
  const output_path =
    asString(args.output_path) ||
    `.autopus/runs/${project_slug}/project-brief.json`;
  const gateErr = assertBriefPath(output_path, opts.workspaceRoot);
  if (gateErr) return err(gateErr);
  const resolved = resolve(opts.workspaceRoot, output_path);
  const created = !existsSync(resolved);
  try {
    mkdirSync(dirname(resolved), { recursive: true });
    await writeProjectBriefTemplate(resolved);
    return ok({ brief_path: output_path, created });
  } catch (e) {
    return err(`init_project_brief failed: ${(e as Error).message}`);
  }
}

async function updateBrief(
  opts: BriefContextOptions,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const brief_path = asString(args.brief_path);
  const patch = args.patch as Record<string, unknown> | undefined;
  if (!patch || typeof patch !== "object") {
    return err("update_project_brief: patch object required");
  }
  const gateErr = assertBriefPath(brief_path, opts.workspaceRoot);
  if (gateErr) return err(gateErr);
  const resolved = resolve(opts.workspaceRoot, brief_path);
  if (!existsSync(resolved)) return err(`brief not found: ${brief_path}`);
  try {
    const raw = readFileSync(resolved, "utf8");
    const { prefix, parsed } = parseBriefJson(raw);
    const applied: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      parsed[k] = v;
      applied.push(k);
    }
    await writeFile(
      resolved,
      `${prefix}${JSON.stringify(parsed, null, 2)}\n`,
      "utf8",
    );
    return ok({ brief_path, applied_fields: applied });
  } catch (e) {
    return err(`update_project_brief failed: ${(e as Error).message}`);
  }
}

export function createBriefReadContext(
  opts: BriefContextOptions,
): BriefReadContext {
  return {
    tools: BRIEF_READ_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "get_project_brief":
          return getBrief(opts, args);
        case "validate_project_brief":
          return validateBrief(opts, args);
        default:
          return err(`unknown brief read tool: ${name}`);
      }
    },
  };
}

export function createBriefWriteContext(
  opts: BriefContextOptions,
): BriefWriteContext {
  return {
    tools: BRIEF_WRITE_TOOLS,
    async dispatch(name, args) {
      switch (name) {
        case "init_project_brief":
          return initBrief(opts, args);
        case "update_project_brief":
          return updateBrief(opts, args);
        default:
          return err(`unknown brief write tool: ${name}`);
      }
    },
  };
}
