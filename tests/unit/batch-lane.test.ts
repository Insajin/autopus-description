// SPEC-FIGMA-005 T13 / AC-S5, AC-S6: Anthropic Message Batches lane wrapper.
// REQ-05, REQ-10. Mocks the SDK's messages.batches namespace and verifies
// submit / poll / fetch behaviour, custom_id ↔ input order alignment, and
// partial-failure surfacing.

import { describe, expect, it, vi } from "vitest";

import {
  alignByInputOrder,
  composeBatchRequest,
  fetchResults,
  pollUntilComplete,
  submitBatch,
  type BatchResultRow,
} from "../../src/providers/batch-lane.js";

function makeFakeClient(scenario: {
  createId?: string;
  retrievePlan: Array<{
    processing_status: "in_progress" | "ended" | "canceled";
    succeeded?: number;
    errored?: number;
  }>;
  rows: BatchResultRow[];
}) {
  let retrieveIdx = 0;
  return {
    messages: {
      batches: {
        create: vi.fn(async (_req: unknown) => ({
          id: scenario.createId ?? "msgbatch_test_001",
        })),
        retrieve: vi.fn(async (id: string) => {
          const step =
            scenario.retrievePlan[
              Math.min(retrieveIdx, scenario.retrievePlan.length - 1)
            ];
          retrieveIdx++;
          return {
            id,
            processing_status: step.processing_status,
            request_counts: {
              succeeded: step.succeeded ?? 0,
              errored: step.errored ?? 0,
            },
            results_url: "https://mock/results",
          };
        }),
        results: function* (_id: string) {
          for (const r of scenario.rows) yield r;
        },
      },
    },
  };
}

describe("batch-lane wrapper (AC-S5)", () => {
  it("submitBatch returns the batch_id from SDK response", async () => {
    const client = makeFakeClient({
      createId: "msgbatch_abc123",
      retrievePlan: [{ processing_status: "ended", succeeded: 30 }],
      rows: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await submitBatch(client as any, []);
    expect(id).toBe("msgbatch_abc123");
  });

  it("pollUntilComplete returns when processing_status === ended", async () => {
    const client = makeFakeClient({
      retrievePlan: [
        { processing_status: "in_progress" },
        { processing_status: "ended", succeeded: 30, errored: 0 },
      ],
      rows: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counts = await pollUntilComplete(client as any, "msgbatch_abc", {
      pollIntervalMs: 1,
      maxWaitMs: 5000,
    });
    expect(counts.succeeded).toBe(30);
    expect(counts.errored).toBe(0);
  });

  it("pollUntilComplete throws BATCH_PARTIAL_FAILURE on canceled state", async () => {
    const client = makeFakeClient({
      retrievePlan: [{ processing_status: "canceled" }],
      rows: [],
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pollUntilComplete(client as any, "msgbatch_abc", {
        pollIntervalMs: 1,
        maxWaitMs: 100,
      }),
    ).rejects.toThrow(/canceled/);
  });

  it("fetchResults yields all rows from the SDK iterator", async () => {
    const client = makeFakeClient({
      retrievePlan: [{ processing_status: "ended", succeeded: 2 }],
      rows: [
        {
          custom_id: "F1",
          result: {
            type: "succeeded",
            message: { content: [{ type: "text", text: "{}" }], usage: {} },
          },
        },
        {
          custom_id: "F2",
          result: {
            type: "succeeded",
            message: { content: [{ type: "text", text: "{}" }], usage: {} },
          },
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchResults(client as any, "msgbatch_abc");
    expect(rows).toHaveLength(2);
    expect(rows[0].custom_id).toBe("F1");
  });
});

describe("alignByInputOrder (AC-S5 ordering invariant)", () => {
  it("re-orders provider rows back to input order", () => {
    const rows: BatchResultRow[] = [
      {
        custom_id: "F30",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: "{}" }], usage: {} },
        },
      },
      {
        custom_id: "F1",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: "{}" }], usage: {} },
        },
      },
      {
        custom_id: "F2",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: "{}" }], usage: {} },
        },
      },
    ];
    const aligned = alignByInputOrder(["F1", "F2", "F30"], rows);
    expect(aligned.map((r) => r.custom_id)).toEqual(["F1", "F2", "F30"]);
  });

  it("emits synthetic errored row for missing custom_id", () => {
    const rows: BatchResultRow[] = [
      {
        custom_id: "F1",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: "{}" }], usage: {} },
        },
      },
    ];
    const aligned = alignByInputOrder(["F1", "F2"], rows);
    expect(aligned[1].custom_id).toBe("F2");
    expect(aligned[1].result.type).toBe("errored");
  });
});

describe("composeBatchRequest payload shape", () => {
  it("includes cache_control on system block when cache_control_region is set", () => {
    const req = composeBatchRequest("F1", "frame body", undefined, {
      model_id: "claude-sonnet-4-6",
      temperature: 0,
      max_output_tokens: 2000,
      cache_control_region: "STATIC PREFIX",
    });
    expect(req.params.system?.[0]).toEqual({
      type: "text",
      text: "STATIC PREFIX",
      cache_control: { type: "ephemeral" },
    });
  });

  it("includes response_format strict when structured_output_schema is set", () => {
    const req = composeBatchRequest("F1", "frame body", undefined, {
      model_id: "claude-sonnet-4-6",
      temperature: 0,
      max_output_tokens: 2000,
      structured_output_schema: { type: "object" },
    });
    expect(req.params.response_format).toEqual({
      type: "json_schema",
      json_schema: { strict: true, schema: { type: "object" } },
    });
  });

  it("uses file_id reference when opts.file_id is supplied", () => {
    const req = composeBatchRequest(
      "F1",
      "frame body",
      Buffer.from([0x89, 0x50]),
      {
        model_id: "claude-sonnet-4-6",
        temperature: 0,
        max_output_tokens: 2000,
        file_id: "file_xyz",
      },
    );
    const userBlocks = req.params.messages[0].content as Array<
      Record<string, unknown>
    >;
    expect(userBlocks[0]).toEqual({
      type: "image",
      source: { type: "file", file_id: "file_xyz" },
    });
  });
});
