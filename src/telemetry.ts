// SPEC-FIGMA-003 T11: Telemetry aggregator.
// Sum identity (INV-009): total_token_cost == sum(input + output) over
// SUCCESSFUL entries only — failed frames are excluded from the manifest
// and from the cost sum.

export type CallMode = "node-only" | "vision";

export interface TelemetryEntry {
  screen_id: string;
  input_tokens: number;
  output_tokens: number;
  mode: CallMode;
}

export interface TelemetryFinal {
  total_token_cost: number;
  vision_call_count: number;
  per_mode_breakdown: {
    "node-only": { calls: number; input_tokens: number; output_tokens: number };
    vision: { calls: number; input_tokens: number; output_tokens: number };
  };
}

export class Telemetry {
  private readonly entries: TelemetryEntry[] = [];
  private vision_count = 0;

  recordEntry(
    screen_id: string,
    input_tokens: number,
    output_tokens: number,
    mode: CallMode,
  ): void {
    this.entries.push({ screen_id, input_tokens, output_tokens, mode });
  }

  // Routing engine calls this when entering the Vision retry branch
  // (REQ-03 observability hook).
  incrementVisionCount(): void {
    this.vision_count += 1;
  }

  finalize(): TelemetryFinal {
    const breakdown: TelemetryFinal["per_mode_breakdown"] = {
      "node-only": { calls: 0, input_tokens: 0, output_tokens: 0 },
      vision: { calls: 0, input_tokens: 0, output_tokens: 0 },
    };
    let total = 0;
    for (const e of this.entries) {
      total += e.input_tokens + e.output_tokens;
      const slot = breakdown[e.mode];
      slot.calls += 1;
      slot.input_tokens += e.input_tokens;
      slot.output_tokens += e.output_tokens;
    }
    return {
      total_token_cost: total,
      vision_call_count: this.vision_count,
      per_mode_breakdown: breakdown,
    };
  }
}
