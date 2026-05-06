const TOKEN_REGEX = /(figd_[A-Za-z0-9_-]{16,}|xoxb-[A-Za-z0-9_-]{8,})/g;
const REDACTED = "<REDACTED>";

export function redactTokens(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  return input.replace(TOKEN_REGEX, REDACTED);
}

export function redactObject(value: unknown): unknown {
  if (typeof value === "string") return redactTokens(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactObject(v);
    }
    return out;
  }
  return value;
}

export const redact = redactTokens;
