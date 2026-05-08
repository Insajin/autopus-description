import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectInvocation(metaUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;
  try {
    return resolve(fileURLToPath(metaUrl)) === resolve(argvPath);
  } catch {
    return false;
  }
}
