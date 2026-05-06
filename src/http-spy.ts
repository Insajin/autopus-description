/**
 * SPEC-FIGMA-002 AC-S10 spy: records {method, path} for each call so the test
 * can assert no POST/PUT/PATCH/DELETE invocation and no comments|branches|plugin_data path.
 */

export interface SpyInvocation {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
}

export interface HttpSpy {
  readonly invocations: SpyInvocation[];
  get(path: string): Promise<{ status: number; bodyJson?: unknown }>;
  post(path: string): Promise<never>;
  put(path: string): Promise<never>;
  patch(path: string): Promise<never>;
  delete(path: string): Promise<never>;
}

// @AX:NOTE:[AUTO] — REQ-10 / INV-004 runtime read-only gate; AC-S10 oracle requires zero non-GET invocations.
// Importers: src/read-adapter.ts (production driver) and tests/read-only-invariant.test.ts (oracle). Fan-in is 2 — below the Phase 2.5 ANCHOR threshold of 3 — so this is recorded as a NOTE rather than an ANCHOR. POST/PUT/PATCH/DELETE methods throw immediately on call so any accidental write surface raises a test failure within microseconds, not silently. The throw also pushes the offending method into invocations[] so the assertion message points at the leaking call site.
export function createHttpSpy(): HttpSpy {
  const invocations: SpyInvocation[] = [];
  const refusal = (method: SpyInvocation["method"]) =>
    async (path: string): Promise<never> => {
      invocations.push({ method, path });
      throw new Error(`forbidden: ${method} ${path} violates REQ-10 read-only invariant`);
    };
  return {
    invocations,
    async get(path: string) {
      invocations.push({ method: "GET", path });
      return { status: 200 };
    },
    post: refusal("POST"),
    put: refusal("PUT"),
    patch: refusal("PATCH"),
    delete: refusal("DELETE"),
  };
}
