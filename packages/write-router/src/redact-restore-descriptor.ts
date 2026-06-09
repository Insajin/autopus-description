// SPEC-FIGMA-019 T4 — default full-surface restore-annotation redactor.
//
// Mirrors the SEMANTICS of the SPEC-FIGMA-018 daemon redactor
// (`src/daemon/redact-prior-annotation.ts::redactAndMinimizePrior`) — minimize
// each captured prior snapshot to the restore-relevant fields, then scrub every
// retained text field — but is SELF-CONTAINED inside the `packages/write-router`
// boundary. It shares code with the daemon only through the relocated pattern
// source strings (`@autopus/redact-patterns`, via `./redactor.js`); it does NOT
// import the root daemon `src/` tree (REQ-02 layer boundary).
//
// Trust boundary: the captured prior `node.annotations` value is untrusted
// external input — any file collaborator may have left reviewer notes, figd_/
// xoxb-/Bearer tokens, or privileged absolute paths in `labelMarkdown`. This
// function is the router/HTTP-path capture-time scrub seam (REQ-03, REQ-07).

import {
  type AnnotationSnapshot,
  type UndoDescriptor,
} from "./types.js";
import { redactExtendedObject, redactExtendedTokens } from "./redactor.js";

// Minimize a single captured snapshot to the restore-relevant fields only —
// dropping anything else (e.g. author metadata) the untrusted source carried —
// and run every retained text field through the full-surface redactor so
// figd_/xoxb-/Bearer/absolute-path secrets become the `***` placeholder.
function redactAndMinimizeSnapshot(
  snapshot: AnnotationSnapshot,
): AnnotationSnapshot {
  const out: AnnotationSnapshot = {
    // Coerce to a string BEFORE scrubbing: the captured prior is
    // author-uncontrolled, so a non-string labelMarkdown could otherwise pass
    // through redactExtendedObject's non-string branch UNREDACTED (and be cast
    // `as string` — a type lie). String() forces any non-string content through
    // the string-typed redactor. Behavior-preserving for valid strings.
    labelMarkdown: redactExtendedTokens(String(snapshot.labelMarkdown)),
  };
  if (snapshot.categoryId !== undefined) {
    out.categoryId = redactExtendedTokens(String(snapshot.categoryId));
  }
  if (snapshot.properties !== undefined) {
    // properties is an unknown[]; redactExtendedObject recurses into strings
    // nested anywhere inside it.
    out.properties = redactExtendedObject(snapshot.properties) as unknown[];
  }
  return out;
}

// Redact + minimize a `restore-annotation` undo descriptor. Returns a NEW
// descriptor of the same shape; the input is never mutated (REQ-04). Any other
// descriptor variant (`noop`, `delete-node`, etc.) is returned unchanged so the
// seam is a safe identity for non-annotation writes (REQ-06).
// @AX:WARN: [AUTO] trust boundary — scrubs the untrusted captured prior `node.annotations` (any collaborator may have left tokens/paths in labelMarkdown) to the 4-class surface before it reaches the in-memory UndoRegistry or HTTP response.
// @AX:REASON: this is the router/HTTP capture-time scrub seam (REQ-03/REQ-04/REQ-05/REQ-07); the input is external and must never be trusted or mutated in place.
export function redactRestoreDescriptor(
  descriptor: UndoDescriptor,
): UndoDescriptor {
  if (descriptor.type !== "restore-annotation") {
    return descriptor;
  }
  return {
    type: "restore-annotation",
    node_id: descriptor.node_id,
    prior: descriptor.prior.map(redactAndMinimizeSnapshot),
  };
}
