import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream, type EchoBody, type Upstream } from "./support/upstream.js";

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function setup(route: Record<string, unknown> = {}) {
  const upstream: Upstream = await startUpstream();
  const app = await buildApp({
    config: gatewayConfig({
      routes: [{ prefix: "/api/users", upstreams: [upstream.url], ...route }],
    }),
  });
  cleanup.push(() => app.close(), upstream.close);
  return { app, upstream };
}

describe("proxy", () => {
  it("strips the prefix and keeps the query string", async () => {
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/users/42?expand=orders" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ method: "GET", url: "/42?expand=orders" });
  });

  it("keeps the prefix when stripPrefix is false", async () => {
    const { app } = await setup({ stripPrefix: false });

    const res = await app.inject({ method: "GET", url: "/api/users" });

    expect(res.json()).toMatchObject({ url: "/api/users" });
  });

  it("forwards method and json body", async () => {
    const { app } = await setup();

    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: { name: "Ana" },
    });

    expect(res.json()).toMatchObject({ method: "POST", url: "/", body: { name: "Ana" } });
  });

  it("returns 404 for paths outside any route", async () => {
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/orders" });

    expect(res.statusCode).toBe(404);
  });
});

describe("proxy headers", () => {
  it("generates a request id and sends it both ways", async () => {
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/users/1" });

    const id = res.headers["x-request-id"];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.json<EchoBody>().headers["x-request-id"]).toBe(id);
  });

  it("propagates an incoming request id", async () => {
    const { app } = await setup();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/1",
      headers: { "x-request-id": "abc-123" },
    });

    expect(res.headers["x-request-id"]).toBe("abc-123");
    expect(res.json<EchoBody>().headers["x-request-id"]).toBe("abc-123");
  });

  it("replaces a malformed request id", async () => {
    const { app } = await setup();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/1",
      headers: { "x-request-id": "bad id\twith spaces" },
    });

    expect(res.headers["x-request-id"]).not.toBe("bad id\twith spaces");
  });

  it("adds x-forwarded headers and appends to an existing x-forwarded-for", async () => {
    const { app } = await setup();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/1",
      headers: { host: "gateway.local", "x-forwarded-for": "203.0.113.9" },
      remoteAddress: "10.0.0.5",
    });

    expect(res.json<EchoBody>().headers).toMatchObject({
      "x-forwarded-for": "203.0.113.9, 10.0.0.5",
      "x-forwarded-proto": "http",
      "x-forwarded-host": "gateway.local",
    });
  });

  it("does not forward hop-by-hop headers", async () => {
    const { app } = await setup();

    const res = await app.inject({
      method: "GET",
      url: "/api/users/1",
      headers: {
        connection: "keep-alive, x-internal",
        "keep-alive": "timeout=5",
        "x-internal": "secret",
        "proxy-authorization": "Basic Zm9vOmJhcg==",
        "x-custom": "kept",
      },
    });

    const headers = res.json<EchoBody>().headers;
    expect(headers["x-custom"]).toBe("kept");
    expect(headers).not.toHaveProperty("x-internal");
    expect(headers).not.toHaveProperty("keep-alive");
    expect(headers).not.toHaveProperty("proxy-authorization");
  });
});
