// SPEC-FIGMA-003 T8: Confidence calibration scaffold.
// Phase 0 ECE measurement happens after PM ground-truth labeling. Until then
// temperature scaling defaults to T=1.0 (no-op) and conformal is hook-only.

export type CalibrationMethod = "temperature_scaling" | "conformal";

export interface CalibrationParams {
  // Temperature scaling factor. T=1.0 is identity. T<1 sharpens; T>1 flattens.
  temperature?: number;
  // Conformal prediction parameters — reserved for Phase 0 follow-up.
  conformal?: {
    quantile?: number;
  };
}

const DEFAULT_TEMPERATURE = 1.0;

function applyTemperatureScaling(raw: number, T: number): number {
  if (T <= 0) return raw;
  if (T === 1) return raw;
  // raw ** (1/T) keeps the value in [0,1] for raw in [0,1].
  return Math.pow(raw, 1 / T);
}

export function calibrateConfidence(
  raw: number,
  method: CalibrationMethod = "temperature_scaling",
  params: CalibrationParams = {},
): number {
  if (raw < 0 || raw > 1 || Number.isNaN(raw)) {
    return raw;
  }
  switch (method) {
    case "temperature_scaling": {
      const T = params.temperature ?? DEFAULT_TEMPERATURE;
      return applyTemperatureScaling(raw, T);
    }
    case "conformal":
      throw new Error(
        "Conformal calibration is not implemented in Phase 0. " +
          "Provide a temperature_scaling fit instead, or wait for Phase 1.",
      );
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}
