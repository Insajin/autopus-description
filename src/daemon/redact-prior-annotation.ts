// SPEC-FIGMA-018 REQ-14 (security, INV-011) — redact + minimize the captured
// prior native-annotation snapshot at capture time, BEFORE it is persisted into
// AppliedWrite or served via the autopus://applied_writes MCP resource.
//
// Trust boundary: the prior `node.annotations` value captured for undo is
// untrusted external input — any file collaborator may have left reviewer notes,
// xoxb-/bearer tokens, or privileged absolute paths in it. The applied_writes
// read path applies only the figd_-specific redactor
// (src/daemon/mcp-stdio-handlers.ts:180), which misses xoxb-/bearer/absolute
// paths. This is a SEPARATE retained-artifact redaction point from REQ-05's
// outbound-wire redaction (redactWire); it does not weaken that path.

import type {
  AnnotationSnapshot,
  UndoDescriptor,
} from "../../packages/write-router/src/types.js";
import { redactExtendedObject } from "./redact-extended.js";

type RestoreAnnotationDescriptor = Extract<
  UndoDescriptor,
  { type: "restore-annotation" }
>;

// SPEC-FIGMA-020 REQ-10 / D8 — the compound `native-with-card` descriptor embeds
// a `restore-annotation` whose `prior` carries the SAME untrusted captured
// `node.annotations`. The daemon must scrub + minimize that embedded native
// before persistence, exactly like the flat path.
type NativeWithCardDescriptor = Extract<
  UndoDescriptor,
  { type: "native-with-card" }
>;

// Minimize a single captured snapshot to the restore-relevant fields only,
// dropping anything else (e.g. author metadata) the untrusted source carried,
// and run every retained text field through the full daemon redactor so
// figd_/xoxb-/bearer/absolute-path secrets become the redactor placeholder.
function redactAndMinimizeSnapshot(
  snapshot: AnnotationSnapshot,
): AnnotationSnapshot {
  const out: AnnotationSnapshot = {
    // redactExtendedObject scrubs a string in place; cast back to string.
    labelMarkdown: redactExtendedObject(snapshot.labelMarkdown) as string,
  };
  if (snapshot.categoryId !== undefined) {
    out.categoryId = redactExtendedObject(snapshot.categoryId) as string;
  }
  if (snapshot.properties !== undefined) {
    // properties is an unknown[]; redactExtendedObject recurses into strings
    // nested anywhere inside it.
    out.properties = redactExtendedObject(snapshot.properties) as unknown[];
  }
  return out;
}

// Redact + minimize the `prior` array of a restore-annotation undo descriptor.
// Returns a new descriptor of the same shape; the input is not mutated. So the
// persisted AppliedWrite and the served autopus://applied_writes payload never
// contain the raw captured secret, while undo still restores structurally from
// the redacted minimized value.
// @AX:WARN [AUTO]: security trust boundary — captured prior node.annotations is untrusted external input (REQ-14, INV-011).
// @AX:REASON: This is the sole capture-time redaction seam before the snapshot is persisted in AppliedWrite / served via autopus://applied_writes. The read-path redactor only catches figd_; xoxb-/bearer/absolute-path secrets escape unless they are scrubbed here. Weakening or bypassing this function leaks secrets into a retained artifact.
export function redactAndMinimizePrior(
  descriptor: RestoreAnnotationDescriptor,
): RestoreAnnotationDescriptor;
export function redactAndMinimizePrior(
  descriptor: NativeWithCardDescriptor,
): NativeWithCardDescriptor;
export function redactAndMinimizePrior(
  descriptor: RestoreAnnotationDescriptor | NativeWithCardDescriptor,
): RestoreAnnotationDescriptor | NativeWithCardDescriptor {
  // SPEC-FIGMA-020 REQ-10 / D8 — recurse into the compound variant so its
  // embedded native captured prior is minimized AND redacted before persistence,
  // exactly like the flat path. The `card` (`delete-node`) carries only a
  // node_id, no secret, so it is preserved verbatim. Without this branch the
  // compound variant would re-open the SPEC-FIGMA-018 daemon leak class. Flat
  // behavior is byte-unchanged.
  if (descriptor.type === "native-with-card") {
    return {
      type: "native-with-card",
      native: {
        type: "restore-annotation",
        node_id: descriptor.native.node_id,
        prior: descriptor.native.prior.map(redactAndMinimizeSnapshot),
      },
      card: descriptor.card,
    };
  }
  return {
    type: "restore-annotation",
    node_id: descriptor.node_id,
    prior: descriptor.prior.map(redactAndMinimizeSnapshot),
  };
}
