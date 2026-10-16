import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream } from "./support/upstream.js";

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function setup(cacheTtlMs = 60_000) {
  const state = { hits: 0 };
  const upstream = await startUpstream((app) => {
    app.get("/private", (_request, reply) => {
      state.hits += 1;
      return reply.header("cache-control", "no-store").send({ hit: state.hits });
    });
    app.all("/*", () => {
      state.hits += 1;
      return { hit: state.hits };
    });
  });
  const app = await buildApp({
    config: gatewayConfig({ routes: [{ prefix: "/api", upstreams: [upstream.url], cacheTtlMs }] }),
  });
  cleanup.push(() => app.close(), upstream.close);
  return { app, state };
}

describe("response cache", () => {
  it("serves a repeated GET from cache", async () => {
    const { app, state } = await setup();

    const first = await app.inject({ method: "GET", url: "/api/items?page=1" });
    const second = await app.inject({ method: "GET", url: "/api/items?page=1" });

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.json()).toEqual({ hit: 1 });
    expect(second.headers["content-type"]).toContain("application/json");
    expect(state.hits).toBe(1);
  });

  it("keys entries by the full url", async () => {
    const { app, state } = await setup();

    await app.inject({ method: "GET", url: "/api/items?page=1" });
    const other = await app.inject({ method: "GET", url: "/api/items?page=2" });

    expect(other.headers["x-cache"]).toBe("MISS");
    expect(state.hits).toBe(2);
  });

  it("goes back to the upstream after the ttl expires", async () => {
    const { app, state } = await setup(20);

    await app.inject({ method: "GET", url: "/api/items" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const res = await app.inject({ method: "GET", url: "/api/items" });

    expect(res.headers["x-cache"]).toBe("MISS");
    expect(state.hits).toBe(2);
  });

  it("does not cache responses marked no-store", async () => {
    const { app, state } = await setup();

    await app.inject({ method: "GET", url: "/api/private" });
    const res = await app.inject({ method: "GET", url: "/api/private" });

    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.json()).toEqual({ hit: 2 });
    expect(state.hits).toBe(2);
  });

  it("never caches other methods", async () => {
    const { app, state } = await setup();

    await app.inject({ method: "POST", url: "/api/items", payload: {} });
    const res = await app.inject({ method: "POST", url: "/api/items", payload: {} });

    expect(res.headers).not.toHaveProperty("x-cache");
    expect(state.hits).toBe(2);
  });

  it("is off when the route has no ttl", async () => {
    const { app, state } = await setup(0);

    await app.inject({ method: "GET", url: "/api/items" });
    await app.inject({ method: "GET", url: "/api/items" });

    expect(state.hits).toBe(2);
  });
});
