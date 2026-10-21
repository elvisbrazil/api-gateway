import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream } from "./support/upstream.js";

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("GET /metrics", () => {
  it("exposes request counts, cache results and circuit state", async () => {
    const upstream = await startUpstream();
    const app = await buildApp({
      config: gatewayConfig({
        routes: [{ prefix: "/api", upstreams: [upstream.url], cacheTtlMs: 60_000 }],
      }),
    });
    cleanup.push(() => app.close(), upstream.close);

    await app.inject({ method: "GET", url: "/api/a" });
    await app.inject({ method: "GET", url: "/api/a" });
    await app.inject({ method: "GET", url: "/health" });
    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain('gateway_requests_total{route="/api",method="GET",status="200"} 2');
    expect(res.body).toContain('gateway_cache_requests_total{route="/api",result="miss"} 1');
    expect(res.body).toContain('gateway_cache_requests_total{route="/api",result="hit"} 1');
    expect(res.body).toContain(`gateway_circuit_state{route="/api",upstream="${upstream.url}"} 0`);
    expect(res.body).not.toContain('route="/health"');
  });
});
