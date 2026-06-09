// SPEC-FIGMA-018 T9 — captured-prior redaction + minimization scaffold (RED).
// Covers S13 (REQ-14, security): a captured restore-annotation prior bearing a
// Slack token and an absolute path must be scrubbed and minimized BEFORE it is
// persisted into AppliedWrite / served via autopus://applied_writes, while undo
// still restores structurally.
//
// RED expectation: the redaction-before-persist helper (T10) does not exist yet
// on ../apply-tool.js, so the import fails (module export missing).
//
// NOTE (test discovery): the repo vitest config does not include
// src/daemon/tests/** by default — this file is placed at the path the SPEC
// task prescribes; the include glob is extended so it runs. See tester report.

import { describe, it, expect } from "vitest";
import { redactAndMinimizePrior } from "../apply-tool.js";
import { redactExtendedObject } from "../redact-extended.js";
import { REDACTED } from "../../redact-patterns.js";
import { undoNativeAnnotation } from "../../../packages/write-router/src/adapters/native-annotation.js";

const SECRET_LABEL =
  "reviewer token xoxb-LEAKEDSECRET see /Users/reviewer/notes.txt";

function makePriorDescriptor() {
  return {
    type: "restore-annotation" as const,
    node_id: "80:1",
    prior: [
      {
        labelMarkdown: SECRET_LABEL,
        categoryId: "review",
        properties: [{ type: "string", value: "x" }],
        // an extra non-restore field that minimization must drop:
        author: { id: "u-1", name: "reviewer" },
      },
    ],
  };
}

describe("S13: captured prior is redacted and minimized before persist", () => {
  it("the persisted prior contains neither the Slack token nor the absolute path", () => {
    const out = redactAndMinimizePrior(makePriorDescriptor());
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("xoxb-LEAKEDSECRET");
    expect(serialized).not.toContain("/Users/reviewer/notes.txt");
  });

  it("each removed secret is replaced by the daemon redactor placeholder", () => {
    const out = redactAndMinimizePrior(makePriorDescriptor());
    const label = out.prior[0].labelMarkdown;
    expect(label).toContain(REDACTED);
  });

  it("the persisted prior retains only the minimized restore fields", () => {
    const out = redactAndMinimizePrior(makePriorDescriptor());
    const keys = Object.keys(out.prior[0]).sort();
    expect(keys).toEqual(["categoryId", "labelMarkdown", "properties"]);
  });

  it("redaction matches the full daemon redactor (redactExtendedObject) on labelMarkdown", () => {
    const out = redactAndMinimizePrior(makePriorDescriptor());
    const expected = redactExtendedObject(SECRET_LABEL) as string;
    expect(out.prior[0].labelMarkdown).toBe(expected);
  });

  it("minimizes a prior snapshot that has neither categoryId nor properties to labelMarkdown only", () => {
    // Exercises the absent-arm branches of redactAndMinimizeSnapshot: a prior
    // carrying only labelMarkdown must yield exactly { labelMarkdown }.
    const out = redactAndMinimizePrior({
      type: "restore-annotation" as const,
      node_id: "84:1",
      prior: [{ labelMarkdown: "plain note, no secrets" }],
    });
    expect(Object.keys(out.prior[0])).toEqual(["labelMarkdown"]);
    expect(out.prior[0].labelMarkdown).toBe("plain note, no secrets");
  });

  it("redacts and minimizes every snapshot across a multi-snapshot prior", () => {
    const out = redactAndMinimizePrior({
      type: "restore-annotation" as const,
      node_id: "85:1",
      prior: [
        { labelMarkdown: "first xoxb-LEAKEDSECRET note", categoryId: "review" },
        { labelMarkdown: "second clean note" },
      ],
    });
    expect(out.prior).toHaveLength(2);
    expect(JSON.stringify(out)).not.toContain("xoxb-LEAKEDSECRET");
    expect(Object.keys(out.prior[0]).sort()).toEqual(["categoryId", "labelMarkdown"]);
    expect(Object.keys(out.prior[1])).toEqual(["labelMarkdown"]);
  });

  it("returns an empty prior array unchanged (no snapshots to minimize)", () => {
    const out = redactAndMinimizePrior({
      type: "restore-annotation" as const,
      node_id: "86:1",
      prior: [],
    });
    expect(out.prior).toEqual([]);
    expect(out.node_id).toBe("86:1");
  });

  it("undo with the redacted minimized descriptor restores structurally without re-introducing the secret", async () => {
    const out = redactAndMinimizePrior(makePriorDescriptor());
    const writes: Array<{ nodeId: string; labelMarkdown: string }> = [];
    const client = {
      scan: async () => ({ nodes: [] }),
      getAnnotations: async () => ({ annotations: [] }),
      setAnnotation: async (a: { nodeId: string; labelMarkdown: string }) => {
        writes.push(a);
        return { success: true, nodeId: a.nodeId, annotations: [a] };
      },
    };
    await undoNativeAnnotation(out, { figma: client });
    const serialized = JSON.stringify(writes);
    expect(serialized).not.toContain("xoxb-LEAKEDSECRET");
    expect(serialized).not.toContain("/Users/reviewer/notes.txt");
  });
});
