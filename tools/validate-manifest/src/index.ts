#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Ajv2020Mod from "ajv/dist/2020.js";
import * as addFormatsMod from "ajv-formats";

type CompiledValidator = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath: string; schemaPath: string; keyword: string; params: Record<string, unknown>; message?: string }> | null;
};

const Ajv2020Ctor = ((Ajv2020Mod as unknown as { default?: unknown }).default ?? Ajv2020Mod) as unknown as new (opts: { allErrors?: boolean; strict?: boolean }) => {
  addSchema: (schema: unknown, key: string) => void;
  compile: (schema: unknown) => CompiledValidator;
};
const addFormatsFn = ((addFormatsMod as unknown as { default?: unknown }).default ?? addFormatsMod) as unknown as (ajv: unknown) => void;
import { mapAjvError, detectDuplicateScreenIds, type ValidatorError } from "./errors.js";

const HELP_TEXT = `Usage: validate-manifest <path>

Validate a description-manifest.json against SPEC-FIGMA-001 schema.

Options:
  --help, -h    Show this help and exit 0.

Exit codes:
  0  manifest passed validation
  1  manifest failed validation (errors emitted as JSON Lines on stderr)
  2  usage error (missing path or unreadable input)
`;

interface Manifest {
  schema_version?: string;
  pilot_metadata?: unknown;
  frames?: Array<Record<string, unknown>>;
}

function locateSchemaDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../schema"),
    resolve(here, "../../schema"),
    resolve(process.cwd(), "schema"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(join(c, "frame-description.schema.json"), "utf8");
      return c;
    } catch {
      continue;
    }
  }
  throw new Error("schema directory not found; expected schema/frame-description.schema.json");
}

function loadJson(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function buildValidator(schemaDir: string) {
  const frame = loadJson(join(schemaDir, "frame-description.schema.json")) as Record<string, unknown>;
  const manifest = loadJson(join(schemaDir, "description-manifest.schema.json")) as Record<string, unknown>;
  const ajv = new Ajv2020Ctor({ allErrors: true, strict: true });
  addFormatsFn(ajv);
  ajv.addSchema(frame, "frame-description.schema.json");
  return ajv.compile(manifest);
}

function frameCount(data: unknown): number {
  if (data && typeof data === "object" && Array.isArray((data as Manifest).frames)) {
    return (data as Manifest).frames!.length;
  }
  return 0;
}

function emitErrors(errs: ValidatorError[]): void {
  for (const e of errs) {
    process.stderr.write(JSON.stringify(e) + "\n");
  }
}

function summary(passCount: number, failCount: number): string {
  return `RESULT pass=${passCount} fail=${failCount} total=${passCount + failCount}`;
}

function parseArgs(argv: string[]): { help: boolean; path?: string; usage?: string } {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { help: false, usage: "error: missing argument <path>" };
  }
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  const path = args.find((a) => !a.startsWith("-"));
  if (!path) {
    return { help: false, usage: "error: missing argument <path>" };
  }
  return { help: false, path };
}

function main(): number {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (parsed.usage) {
    process.stderr.write(parsed.usage + "\n");
    return 2;
  }
  const targetPath = parsed.path!;
  let data: unknown;
  try {
    data = loadJson(resolve(targetPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot read ${targetPath}: ${msg}\n`);
    return 2;
  }
  let validate: ReturnType<ReturnType<typeof buildValidator>>;
  let validator: ReturnType<typeof buildValidator>;
  try {
    validator = buildValidator(locateSchemaDir());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: schema load failed: ${msg}\n`);
    return 2;
  }
  const ok = validator(data);
  const schemaErrors: ValidatorError[] = [];
  if (!ok && validator.errors) {
    const seen = new Set<string>();
    for (const ajvErr of validator.errors) {
      const mapped = mapAjvError(ajvErr, data);
      if (!mapped) continue;
      const key = `${mapped.code}|${mapped.json_pointer}|${mapped.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      schemaErrors.push(mapped);
    }
  }
  schemaErrors.sort((a, b) => a.json_pointer.localeCompare(b.json_pointer));
  const dupErrors = detectDuplicateScreenIds(data);
  const collected: ValidatorError[] = [...schemaErrors, ...dupErrors];
  if (collected.length === 0) {
    const total = frameCount(data);
    process.stdout.write(summary(total, 0) + "\n");
    return 0;
  }
  emitErrors(collected);
  process.stdout.write(summary(0, collected.length) + "\n");
  return 1;
}

const exitCode = main();
process.exit(exitCode);
