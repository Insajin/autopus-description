// SPEC-FIGMA-005 anthropic SDK error → typed ProviderError mapping.
// Extracted from anthropic-provider.ts to keep the main file under the
// 300-line cap (.claude/rules/autopus/file-size-limit.md).
//
// Mapping rules (REQ-NFR-02 fail-fast):
//   - Strict mode rejection ⇒ SCHEMA_STRICT_INCOMPATIBLE
//   - TypeError on cache_control field ⇒ PROVIDER_SDK_BREAKING_CHANGE
//   - 429 ⇒ RATE_LIMIT_EXCEEDED
//   - Files API quota ⇒ FILES_QUOTA_EXCEEDED
//   - Anything else ⇒ PROVIDER_ERROR

import {
  ErrorCode,
  ProviderError,
  type ProviderOpts,
} from "../types/llm-provider.js";

export function mapSdkError(
  err: unknown,
  sdkVersion: string,
  opts?: ProviderOpts,
): ProviderError {
  const e = err as {
    status?: number;
    message?: string;
    error?: { type?: string; message?: string };
    name?: string;
  };
  const msg = e?.message ?? "Anthropic SDK call failed";
  const errType = e?.error?.type ?? "";
  const errMsg = e?.error?.message ?? "";

  // REQ-02: schema rejection (strict mode incompatible with the schema
  // shape, e.g. anyOf/oneOf rejected). Detect via error.type or message.
  if (
    opts?.structured_output_schema !== undefined &&
    errType === "invalid_request_error" &&
    /strict|json_schema|response_format|schema/i.test(errMsg)
  ) {
    return new ProviderError(
      ErrorCode.SCHEMA_STRICT_INCOMPATIBLE,
      errMsg || msg,
      undefined,
      { http_status: e?.status, raw_error_type: errType },
    );
  }

  // REQ-NFR-02: SDK breaking change — TypeError surfaces when SDK 0.95.x
  // patch changes cache_control field shape (AC-S12 oracle).
  if (e?.name === "TypeError" || /typeerror/i.test(msg)) {
    return new ProviderError(
      ErrorCode.PROVIDER_SDK_BREAKING_CHANGE,
      `${msg} (sdk_version=${sdkVersion})`,
      undefined,
      { http_status: e?.status, sdk_version: sdkVersion },
    );
  }

  if (e?.status === 429) {
    return new ProviderError(ErrorCode.RATE_LIMIT_EXCEEDED, msg, undefined, {
      http_status: 429,
    });
  }
  return new ProviderError(ErrorCode.PROVIDER_ERROR, msg, undefined, {
    http_status: e?.status,
  });
}

export function mapFilesError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { status?: number; message?: string };
  const msg = e?.message ?? "Anthropic Files API call failed";
  if (e?.status === 429 || /quota|rate.?limit/i.test(msg)) {
    return new ProviderError(ErrorCode.FILES_QUOTA_EXCEEDED, msg, undefined, {
      http_status: e?.status,
    });
  }
  return new ProviderError(ErrorCode.PROVIDER_ERROR, msg, undefined, {
    http_status: e?.status,
  });
}
