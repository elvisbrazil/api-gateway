import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream } from "./support/upstream.js";

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function gateway(raw: Record<string, unknown>) {
  const app = await buildApp({ config: gatewayConfig(raw) });
  cleanup.push(() => app.close());
  return app;
}

async function upstream(name: string, status = 200) {
  const server = await startUpstream((app) => {
    app.get("/slow", async () => {
      await sleep(1_500);
      return { name };
    });
    app.get("/*", (_request, reply) => reply.code(status).send({ name }));
  });
  cleanup.push(server.close);
  return server;
}

describe("resilience", () => {
  it("returns 504 when the upstream is slower than the route timeout", async () => {
    const server = await upstream("slow");
    const app = await gateway({
      routes: [{ prefix: "/api", upstreams: [server.url], timeoutMs: 100 }],
    });

    const res = await app.inject({ method: "GET", url: "/api/slow" });

    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: "Gateway Timeout" });
  });

  it("returns 502 when the upstream refuses the connection", async () => {
    const app = await gateway({ routes: [{ prefix: "/api", upstreams: ["http://127.0.0.1:1"] }] });

    const res = await app.inject({ method: "GET", url: "/api/x" });

    expect(res.statusCode).toBe(502);
  });

  it("returns 503 once the circuit for the only upstream is open", async () => {
    const server = await upstream("broken", 500);
    const app = await gateway({
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
      routes: [{ prefix: "/api", upstreams: [server.url] }],
    });

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await app.inject({ method: "GET", url: "/api/x" })).statusCode);
    }

    expect(statuses).toEqual([500, 500, 503]);
  });

  it("routes around an upstream whose circuit is open", async () => {
    const healthy = await upstream("healthy");
    const app = await gateway({
      circuitBreaker: { failureThreshold: 1, cooldownMs: 60_000 },
      routes: [{ prefix: "/api", upstreams: ["http://127.0.0.1:1", healthy.url] }],
    });

    const first = await app.inject({ method: "GET", url: "/api/x" });
    const rest = await Promise.all(
      [1, 2, 3].map(() => app.inject({ method: "GET", url: "/api/x" })),
    );

    expect(first.statusCode).toBe(502);
    expect(rest.map((res) => res.json<{ name: string }>().name)).toEqual([
      "healthy",
      "healthy",
      "healthy",
    ]);
  });
});
