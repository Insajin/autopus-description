/**
 * AC-S10 — read-only invariant (write-blocking)
 *
 * Given a spy wrapping the HTTP/MCP client of the use_figma adapter
 *   And the spy records every method invocation with HTTP method and URL path
 * When the read adapter runs end-to-end against the 30-frame mock fixture
 * Then zero invocations have HTTP method POST | PUT | PATCH | DELETE
 *  And zero invocations have URL paths matching /(comments|branches|plugin_data)/
 *  And every recorded invocation has HTTP method GET
 *
 * Linked: REQ-10, INV-004
 */
import { describe, it, expect } from "vitest";
import { runReadAdapter } from "../src/read-adapter.js";
import { createHttpSpy } from "../src/http-spy.js";

const FORBIDDEN_PATH_REGEX = /(comments|branches|plugin_data)/;

describe("AC-S10: read-only invariant (zero non-GET, no comments/branches/plugin_data)", () => {
  it("zero POST invocations occur during a 30-frame read run", async () => {
    const spy = createHttpSpy();
    await runReadAdapter({ fixturePath: "fixtures/30-frame-mock/", httpClient: spy });
    const posts = spy.invocations.filter((i) => i.method === "POST");
    expect(posts.length).toBe(0);
  });

  it("zero PUT invocations occur", async () => {
    const spy = createHttpSpy();
    await runReadAdapter({ fixturePath: "fixtures/30-frame-mock/", httpClient: spy });
    expect(spy.invocations.filter((i) => i.method === "PUT").length).toBe(0);
  });

  it("zero PATCH invocations occur", async () => {
    const spy = createHttpSpy();
    await runReadAdapter({ fixturePath: "fixtures/30-frame-mock/", httpClient: spy });
    expect(spy.invocations.filter((i) => i.method === "PATCH").length).toBe(0);
  });

  it("zero DELETE invocations occur", async () => {
    const spy = createHttpSpy();
    await runReadAdapter({ fixturePath: "fixtures/30-frame-mock/", httpClient: spy });
    expect(spy.invocations.filter((i) => i.method === "DELETE").length).toBe(0);
  });

  it("zero invocations match /(comments|branches|plugin_data)/ path regex", async () => {
    const spy = createHttpSpy();
    await runReadAdapter({ fixturePath: "fixtures/30-frame-mock/", httpClient: spy });
    const forbidden = spy.invocations.filter((i) => FORBIDDEN_PATH_REGEX.test(i.path));
    expect(forbidden.length).toBe(0);
  });

  it("every recorded invocation has HTTP method GET", async () => {
    const spy = createHttpSpy();
    await runReadAdapter({ fixturePath: "fixtures/30-frame-mock/", httpClient: spy });
    expect(spy.invocations.length).toBeGreaterThan(0);
    for (const inv of spy.invocations) {
      expect(inv.method).toBe("GET");
    }
  });
});
