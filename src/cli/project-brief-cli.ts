import {
  PROJECT_BRIEF_QUESTIONS,
  loadProjectBrief,
  writeProjectBriefTemplate,
  type ProjectBrief,
} from "../project-brief.js";

export const PROJECT_BRIEF_HELP = `  --project-brief=PATH trusted project/context/policy JSON for generation.
  --init-project-brief=PATH
                        write a project brief question template and exit.
  --require-project-brief
                        fail with the question flow if no brief is supplied.`;

export interface ProjectBriefArgs {
  project_brief?: string;
  init_project_brief?: string;
  require_project_brief?: boolean;
}

export function parseProjectBriefArg(
  arg: string,
  out: ProjectBriefArgs,
): boolean {
  if (arg.startsWith("--project-brief=")) {
    out.project_brief = arg.slice("--project-brief=".length);
    return true;
  }
  if (arg.startsWith("--init-project-brief=")) {
    out.init_project_brief = arg.slice("--init-project-brief=".length);
    return true;
  }
  if (arg === "--require-project-brief") {
    out.require_project_brief = true;
    return true;
  }
  return false;
}

export function projectBriefPathHasNull(args: ProjectBriefArgs): boolean {
  return Boolean(
    args.project_brief?.includes("\0") ||
      args.init_project_brief?.includes("\0"),
  );
}

export async function handleProjectBriefInit(
  args: ProjectBriefArgs,
): Promise<boolean> {
  if (!args.init_project_brief) return false;
  await writeProjectBriefTemplate(args.init_project_brief);
  process.stdout.write(`wrote project brief template: ${args.init_project_brief}\n`);
  return true;
}

export async function resolveProjectBrief(
  args: ProjectBriefArgs,
): Promise<ProjectBrief | undefined | 2> {
  if (args.project_brief) {
    try {
      return await loadProjectBrief(args.project_brief);
    } catch (err) {
      process.stderr.write(
        `error: project brief unreadable: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 2;
    }
  }
  if (args.require_project_brief) {
    process.stderr.write("error: project brief required before description generation\n");
    process.stderr.write(PROJECT_BRIEF_QUESTIONS);
    return 2;
  }
  return undefined;
}
