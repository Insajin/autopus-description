// SPEC-FIGMA-004 — error-message redaction for the WriteRouter reject path.
// Extracted from index.ts to keep that file under the 300-line limit.

import { WriteRouterError } from "./types.js";
import { redactTokens } from "./redactor.js";

// Scrub figd_/xoxb- tokens from an error message while preserving the original
// error identity (instanceof + WriteRouterError.code) by mutating in place.
export function redactErrorMessage(err: unknown): unknown {
  if (err instanceof WriteRouterError) {
    err.message = redactTokens(err.message);
    return err;
  }
  if (err instanceof Error) {
    err.message = redactTokens(err.message);
    return err;
  }
  return new Error(redactTokens(String(err)));
}
