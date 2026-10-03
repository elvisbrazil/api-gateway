import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream } from "./support/upstream.js";

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function setup(rateLimit: Record<string, unknown>) {
  const upstream = await startUpstream();
  const app = await buildApp({
    config: gatewayConfig({
      routes: [
        { prefix: "/limited", upstreams: [upstream.url], rateLimit },
        { prefix: "/open", upstreams: [upstream.url] },
      ],
    }),
  });
  cleanup.push(() => app.close(), upstream.close);
  return app;
}

describe("rate limiting", () => {
  it("sends RateLimit headers on allowed requests", async () => {
    const app = await setup({ limit: 2, windowMs: 60_000 });

    const res = await app.inject({ method: "GET", url: "/limited/a" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("2");
    expect(res.headers["ratelimit-remaining"]).toBe("1");
    expect(Number(res.headers["ratelimit-reset"])).toBeGreaterThan(0);
  });

  it("answers 429 with Retry-After once the limit is hit", async () => {
    const app = await setup({ limit: 2, windowMs: 60_000 });

    await app.inject({ method: "GET", url: "/limited/a" });
    await app.inject({ method: "GET", url: "/limited/a" });
    const res = await app.inject({ method: "GET", url: "/limited/a" });

    expect(res.statusCode).toBe(429);
    expect(res.headers["ratelimit-remaining"]).toBe("0");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(res.json()).toMatchObject({ error: "Too Many Requests" });
  });

  it("counts clients separately by ip", async () => {
    const app = await setup({ limit: 1, windowMs: 60_000 });

    await app.inject({ method: "GET", url: "/limited", remoteAddress: "10.0.0.1" });
    const other = await app.inject({ method: "GET", url: "/limited", remoteAddress: "10.0.0.2" });

    expect(other.statusCode).toBe(200);
  });

  it("counts by api key when configured", async () => {
    const app = await setup({ limit: 1, windowMs: 60_000, key: "apiKey" });

    await app.inject({ method: "GET", url: "/limited", headers: { "x-api-key": "one" } });
    const sameKey = await app.inject({
      method: "GET",
      url: "/limited",
      headers: { "x-api-key": "one" },
    });
    const otherKey = await app.inject({
      method: "GET",
      url: "/limited",
      headers: { "x-api-key": "two" },
    });

    expect(sameKey.statusCode).toBe(429);
    expect(otherKey.statusCode).toBe(200);
  });

  it("leaves routes without a policy alone", async () => {
    const app = await setup({ limit: 1, windowMs: 60_000 });

    const res = await app.inject({ method: "GET", url: "/open" });

    expect(res.headers).not.toHaveProperty("ratelimit-limit");
  });
});
