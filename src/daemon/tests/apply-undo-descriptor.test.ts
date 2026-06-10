// SPEC-FIGMA-020 Gate 3 — focused unit coverage for the undo-descriptor
// hydration + persist-time resolution helpers factored out of apply-tool.ts.
//
// hydrateUndoDescriptor maps a dryRun-stage undo template onto the node ids the
// plugin returned at apply time. Each union arm has distinct hydration behavior
// (the `??` fallbacks, the pass-through arms, the compound native-with-card
// dual-hydrate). computePersistedDescriptor then resolves the descriptor that is
// actually persisted, applying the capture-time redactor to embedded priors.
//
// These assert the concrete hydrated/persisted descriptor SHAPE per arm, not
// merely that the call returns.

import { describe, it, expect } from "vitest";
import {
  hydrateUndoDescriptor,
  computePersistedDescriptor,
} from "../apply-undo-descriptor.js";
import type { UndoDescriptor } from "../../../packages/write-router/src/types.js";

describe("hydrateUndoDescriptor — undefined / noop", () => {
  it("returns a noop descriptor when the template is undefined", () => {
    expect(hydrateUndoDescriptor(undefined, ["80:1"])).toEqual({ type: "noop" });
  });

  it("returns a noop descriptor verbatim for a noop template", () => {
    expect(hydrateUndoDescriptor({ type: "noop" }, ["80:1"])).toEqual({
      type: "noop",
    });
  });
});

describe("hydrateUndoDescriptor — delete-node", () => {
  it("hydrates node_id from the FIRST collected plugin id", () => {
    const out = hydrateUndoDescriptor(
      { type: "delete-node", node_id: "TEMPLATE" },
      ["100:5"],
    );
    expect(out).toEqual({ type: "delete-node", node_id: "100:5" });
  });

  it("falls back to the template node_id when no ids were collected (?? branch)", () => {
    const out = hydrateUndoDescriptor(
      { type: "delete-node", node_id: "FALLBACK" },
      [],
    );
    expect(out).toEqual({ type: "delete-node", node_id: "FALLBACK" });
  });
});

describe("hydrateUndoDescriptor — delete-comment", () => {
  it("hydrates comment_id from the FIRST collected plugin id", () => {
    const out = hydrateUndoDescriptor(
      { type: "delete-comment", comment_id: "TEMPLATE" },
      ["c-99"],
    );
    expect(out).toEqual({ type: "delete-comment", comment_id: "c-99" });
  });

  it("falls back to the template comment_id when no ids were collected (?? branch)", () => {
    const out = hydrateUndoDescriptor(
      { type: "delete-comment", comment_id: "c-FALLBACK" },
      [],
    );
    expect(out).toEqual({ type: "delete-comment", comment_id: "c-FALLBACK" });
  });
});

describe("hydrateUndoDescriptor — clear-plugin-data", () => {
  it("passes the descriptor through unchanged (spread copy, ignores collected ids)", () => {
    const template: UndoDescriptor = {
      type: "clear-plugin-data",
      node_id: "80:1",
      key: "autopus.annotation",
    };
    const out = hydrateUndoDescriptor(template, ["IGNORED"]);
    expect(out).toEqual({
      type: "clear-plugin-data",
      node_id: "80:1",
      key: "autopus.annotation",
    });
    // Pass-through is a copy, not the same reference.
    expect(out).not.toBe(template);
  });
});

describe("hydrateUndoDescriptor — restore-frame-name", () => {
  it("passes the descriptor through unchanged (spread copy, ignores collected ids)", () => {
    const template: UndoDescriptor = {
      type: "restore-frame-name",
      node_id: "80:1",
      original_name: "원래 이름",
    };
    const out = hydrateUndoDescriptor(template, ["IGNORED"]);
    expect(out).toEqual({
      type: "restore-frame-name",
      node_id: "80:1",
      original_name: "원래 이름",
    });
    expect(out).not.toBe(template);
  });
});

describe("hydrateUndoDescriptor — restore-annotation", () => {
  it("hydrates node_id from the first id and carries the prior snapshot unchanged", () => {
    const prior = [{ labelMarkdown: "manual note", categoryId: "review" }];
    const out = hydrateUndoDescriptor(
      { type: "restore-annotation", node_id: "TEMPLATE", prior },
      ["84:2"],
    );
    expect(out).toEqual({
      type: "restore-annotation",
      node_id: "84:2",
      prior,
    });
    // The captured prior array is carried through by reference (unchanged).
    expect((out as Extract<UndoDescriptor, { type: "restore-annotation" }>).prior).toBe(
      prior,
    );
  });

  it("falls back to the template node_id when no ids were collected (?? branch)", () => {
    const out = hydrateUndoDescriptor(
      { type: "restore-annotation", node_id: "84:FALLBACK", prior: [] },
      [],
    );
    expect(out).toEqual({
      type: "restore-annotation",
      node_id: "84:FALLBACK",
      prior: [],
    });
  });
});

describe("hydrateUndoDescriptor — native-with-card (compound, REQ-08)", () => {
  const template: Extract<UndoDescriptor, { type: "native-with-card" }> = {
    type: "native-with-card",
    native: {
      type: "restore-annotation",
      node_id: "NATIVE_TEMPLATE",
      prior: [{ labelMarkdown: "prior note" }],
    },
    card: { type: "delete-node", node_id: "CARD_TEMPLATE" },
  };

  it("hydrates the native node_id from index 0 and the card node_id from index 1", () => {
    const out = hydrateUndoDescriptor(template, ["native-applied", "card-created"]);
    expect(out).toEqual({
      type: "native-with-card",
      native: {
        type: "restore-annotation",
        node_id: "native-applied",
        prior: [{ labelMarkdown: "prior note" }],
      },
      card: { type: "delete-node", node_id: "card-created" },
    });
  });

  it("falls back to BOTH template node_ids when no ids were collected (?? branches)", () => {
    const out = hydrateUndoDescriptor(template, []);
    expect(out).toEqual({
      type: "native-with-card",
      native: {
        type: "restore-annotation",
        node_id: "NATIVE_TEMPLATE",
        prior: [{ labelMarkdown: "prior note" }],
      },
      card: { type: "delete-node", node_id: "CARD_TEMPLATE" },
    });
  });

  it("falls back to the card template id when only the native id was collected", () => {
    const out = hydrateUndoDescriptor(template, ["native-applied"]);
    const compound = out as Extract<UndoDescriptor, { type: "native-with-card" }>;
    expect(compound.native.node_id).toBe("native-applied");
    // index 1 is absent → card falls back to its template node_id.
    expect(compound.card.node_id).toBe("CARD_TEMPLATE");
  });
});

describe("computePersistedDescriptor — flat restore-annotation (REQ-10)", () => {
  it("redacts + minimizes the embedded prior before persistence", () => {
    const hydrated: UndoDescriptor = {
      type: "restore-annotation",
      node_id: "80:1",
      prior: [
        {
          labelMarkdown: "leak xoxb-LEAKEDSECRET and /Users/r/notes.txt",
          categoryId: "review",
          // a non-restore field minimization must drop:
          author: { id: "u-1", name: "reviewer" },
        } as never,
      ],
    };
    const out = computePersistedDescriptor(hydrated, false);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("xoxb-LEAKEDSECRET");
    expect(serialized).not.toContain("/Users/r/notes.txt");
    const persisted = out as Extract<UndoDescriptor, { type: "restore-annotation" }>;
    // Minimization dropped the non-restore `author` field.
    expect(Object.keys(persisted.prior[0]).sort()).toEqual([
      "categoryId",
      "labelMarkdown",
    ]);
    expect(persisted.node_id).toBe("80:1");
  });
});

describe("computePersistedDescriptor — compound native-with-card (REQ-07/REQ-10)", () => {
  function makeHydrated(): Extract<UndoDescriptor, { type: "native-with-card" }> {
    return {
      type: "native-with-card",
      native: {
        type: "restore-annotation",
        node_id: "10:1",
        prior: [{ labelMarkdown: "note xoxb-LEAKEDSECRET", categoryId: "review" }],
      },
      card: { type: "delete-node", node_id: "card-9" },
    };
  }

  it("full success keeps BOTH surfaces with the native member redacted", () => {
    const out = computePersistedDescriptor(makeHydrated(), false);
    expect(out.type).toBe("native-with-card");
    const compound = out as Extract<UndoDescriptor, { type: "native-with-card" }>;
    // Card surface preserved verbatim.
    expect(compound.card).toEqual({ type: "delete-node", node_id: "card-9" });
    // Native prior redacted in place.
    expect(JSON.stringify(compound.native)).not.toContain("xoxb-LEAKEDSECRET");
    expect(compound.native.node_id).toBe("10:1");
  });

  it("card failure downgrades to the redacted native-only flat descriptor", () => {
    const out = computePersistedDescriptor(makeHydrated(), true);
    // Downgraded to the flat restore-annotation (card surface dropped).
    expect(out.type).toBe("restore-annotation");
    const flat = out as Extract<UndoDescriptor, { type: "restore-annotation" }>;
    expect(flat.node_id).toBe("10:1");
    expect(JSON.stringify(flat)).not.toContain("xoxb-LEAKEDSECRET");
    // No card surface remains on the downgraded descriptor.
    expect(JSON.stringify(out)).not.toContain("card-9");
  });
});

describe("computePersistedDescriptor — pass-through for non-prior descriptors", () => {
  it("returns a delete-node descriptor unchanged (no redaction needed)", () => {
    const hydrated: UndoDescriptor = { type: "delete-node", node_id: "100:5" };
    const out = computePersistedDescriptor(hydrated, false);
    expect(out).toBe(hydrated);
  });

  it("returns a noop descriptor unchanged", () => {
    const hydrated: UndoDescriptor = { type: "noop" };
    expect(computePersistedDescriptor(hydrated, false)).toEqual({ type: "noop" });
  });
});
