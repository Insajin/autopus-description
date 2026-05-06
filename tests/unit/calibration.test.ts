// SPEC-FIGMA-003 Phase 3 coverage: src/calibration.ts (T8 — confidence calibration scaffold).
import { describe, it, expect } from "vitest";
import { calibrateConfidence } from "../../src/calibration.js";

describe("calibrateConfidence — temperature scaling", () => {
  it("T=1.0 (default) is identity", () => {
    expect(calibrateConfidence(0.7)).toBe(0.7);
    expect(calibrateConfidence(0.0)).toBe(0.0);
    expect(calibrateConfidence(1.0)).toBe(1.0);
  });

  it("explicit T=1.0 short-circuits to identity", () => {
    expect(calibrateConfidence(0.42, "temperature_scaling", { temperature: 1 })).toBe(0.42);
  });

  it("T=2.0 flattens (raises low values toward 1)", () => {
    // raw=0.5, T=2 → 0.5 ** (1/2) = sqrt(0.5) ≈ 0.7071
    const out = calibrateConfidence(0.5, "temperature_scaling", { temperature: 2 });
    expect(out).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("T=0.5 sharpens (suppresses values away from 1)", () => {
    // raw=0.7, T=0.5 → 0.7 ** 2 = 0.49
    const out = calibrateConfidence(0.7, "temperature_scaling", { temperature: 0.5 });
    expect(out).toBeCloseTo(0.49, 10);
  });

  it("T<=0 falls back to identity (defensive)", () => {
    expect(calibrateConfidence(0.6, "temperature_scaling", { temperature: 0 })).toBe(0.6);
    expect(calibrateConfidence(0.6, "temperature_scaling", { temperature: -1 })).toBe(0.6);
  });

  it("preserves [0,1] bound for boundary inputs under any positive T", () => {
    for (const T of [0.1, 0.5, 1, 2, 10]) {
      expect(calibrateConfidence(0, "temperature_scaling", { temperature: T })).toBe(0);
      expect(calibrateConfidence(1, "temperature_scaling", { temperature: T })).toBe(1);
    }
  });
});

describe("calibrateConfidence — out-of-range inputs", () => {
  it("raw < 0 returns input unchanged (no calibration applied)", () => {
    expect(calibrateConfidence(-0.5)).toBe(-0.5);
    expect(calibrateConfidence(-0.5, "temperature_scaling", { temperature: 2 })).toBe(-0.5);
  });

  it("raw > 1 returns input unchanged", () => {
    expect(calibrateConfidence(1.5)).toBe(1.5);
    expect(calibrateConfidence(2, "temperature_scaling", { temperature: 0.5 })).toBe(2);
  });

  it("NaN raw returns NaN unchanged (Number.isNaN guard)", () => {
    expect(calibrateConfidence(Number.NaN)).toBeNaN();
  });
});

describe("calibrateConfidence — conformal hook", () => {
  it("conformal method throws not-implemented error in Phase 0", () => {
    expect(() => calibrateConfidence(0.7, "conformal")).toThrow(
      /not implemented in Phase 0/i,
    );
  });

  it("conformal error message references temperature_scaling fallback", () => {
    expect(() => calibrateConfidence(0.7, "conformal", { conformal: { quantile: 0.9 } }))
      .toThrow(/temperature_scaling/);
  });
});
