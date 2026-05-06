import type { ErrorObject } from "ajv";

export interface ValidatorError {
  code: string;
  json_pointer: string;
  message: string;
}

// @AX:NOTE: [AUTO] must mirror write_target enum in schema/frame-description.schema.json
const WRITE_TARGET_DISPLAY = "{annotation_card, descriptions_page, frame_name, plugin_data, none}";

function lookup(data: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return data;
  const parts = pointer.split("/").slice(1).map(decodePointerSegment);
  let cur: unknown = data;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (Number.isNaN(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function decodePointerSegment(seg: string): string {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

function encodePointerSegment(seg: string): string {
  return seg.replace(/~/g, "~0").replace(/\//g, "~1");
}

function formatNumber(n: unknown): string {
  if (typeof n !== "number") return String(n);
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

function formatEnumDisplay(values: unknown): string {
  if (Array.isArray(values)) {
    return "{" + values.map((v) => String(v)).join(", ") + "}";
  }
  return "{}";
}

export function mapAjvError(err: ErrorObject, data: unknown): ValidatorError | null {
  const instancePath = err.instancePath ?? "";
  const params = (err.params ?? {}) as Record<string, unknown>;
  switch (err.keyword) {
    case "required": {
      const missing = String(params.missingProperty ?? "");
      const pointer = `${instancePath}/${encodePointerSegment(missing)}`;
      return { code: "MISSING_REQUIRED", json_pointer: pointer, message: "required field absent" };
    }
    case "enum": {
      const value = lookup(data, instancePath);
      const display = instancePath.endsWith("/write_target") ? WRITE_TARGET_DISPLAY : formatEnumDisplay(params.allowedValues);
      return { code: "ENUM_VIOLATION", json_pointer: instancePath, message: `value '${String(value)}' not in ${display}` };
    }
    case "minimum":
    case "maximum": {
      const value = lookup(data, instancePath);
      if (instancePath.endsWith("/confidence")) {
        return { code: "OUT_OF_RANGE", json_pointer: instancePath, message: `confidence ${String(value)} outside [0.0, 1.0]` };
      }
      const op = err.keyword === "minimum" ? ">=" : "<=";
      return { code: "OUT_OF_RANGE", json_pointer: instancePath, message: `value ${String(value)} fails ${op} ${formatNumber(params.limit)}` };
    }
    case "pattern": {
      const value = lookup(data, instancePath);
      return { code: "PATTERN_MISMATCH", json_pointer: instancePath, message: `value '${String(value)}' does not match pattern ${String(params.pattern ?? "")}` };
    }
    case "type":
      return { code: "TYPE_MISMATCH", json_pointer: instancePath, message: `expected type ${String(params.type ?? "")}` };
    case "format":
      return null;
    case "additionalProperties":
    case "unevaluatedProperties": {
      const extra = String(params.additionalProperty ?? params.unevaluatedProperty ?? "");
      const pointer = extra ? `${instancePath}/${encodePointerSegment(extra)}` : instancePath;
      return { code: "TYPE_MISMATCH", json_pointer: pointer, message: `unexpected property '${extra}'` };
    }
    case "uniqueItems":
    case "minItems":
    case "maxItems":
    case "minLength":
    case "maxLength":
      return { code: "OUT_OF_RANGE", json_pointer: instancePath, message: err.message ?? "constraint violated" };
    default:
      return null;
  }
}

export function detectDuplicateScreenIds(data: unknown): ValidatorError[] {
  if (!data || typeof data !== "object") return [];
  const frames = (data as { frames?: unknown }).frames;
  if (!Array.isArray(frames)) return [];
  const seen = new Map<string, number[]>();
  for (let i = 0; i < frames.length; i++) {
    const entry = frames[i];
    if (!entry || typeof entry !== "object") continue;
    const sid = (entry as { screen_id?: unknown }).screen_id;
    if (typeof sid !== "string") continue;
    if (!seen.has(sid)) seen.set(sid, []);
    seen.get(sid)!.push(i);
  }
  const errors: ValidatorError[] = [];
  for (const [sid, indices] of seen) {
    if (indices.length < 2) continue;
    const first = indices[0];
    const others = indices.slice(1);
    const otherList = others.map((i) => `/frames/${i}`).join(", ");
    errors.push({
      code: "DUPLICATE_SCREEN_ID",
      json_pointer: `/frames/${first}/screen_id`,
      message: `duplicate screen_id '${sid}' also at ${otherList}`,
    });
  }
  return errors;
}
