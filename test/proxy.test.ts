import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream, type Upstream } from "./support/upstream.js";

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
