import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { startUpstream } from "./support/upstream.js";

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function countingUpstream(statusFor: (hit: number) => number) {
  const state = { hits: 0 };
  const server = await startUpstream((app) => {
    app.all("/*", (_request, reply) => {
      state.hits += 1;
      const status = statusFor(state.hits);
      return reply.code(status).header("x-attempt", String(state.hits)).send({ status });
    });
  });
  cleanup.push(server.close);
  return { url: server.url, state };
}

async function gateway(upstreams: string[], retries: number) {
  const app = await buildApp({
    config: gatewayConfig({ routes: [{ prefix: "/api", upstreams, retries }] }),
  });
  cleanup.push(() => app.close());
  return app;
}

describe("retries", () => {
  it("retries a failed GET on the next upstream", async () => {
    const broken = await countingUpstream(() => 503);
    const healthy = await countingUpstream(() => 200);
    const app = await gateway([broken.url, healthy.url], 1);

    const res = await app.inject({ method: "GET", url: "/api/items" });

    expect(res.statusCode).toBe(200);
    expect(broken.state.hits).toBe(1);
    expect(healthy.state.hits).toBe(1);
  });

  it("does not leak headers from the failed attempt", async () => {
    const flaky = await countingUpstream((hit) => (hit === 1 ? 500 : 200));
    const app = await gateway([flaky.url], 2);

    const res = await app.inject({ method: "GET", url: "/api/items" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-attempt"]).toBe("2");
  });

  it("gives up after the configured number of retries", async () => {
    const broken = await countingUpstream(() => 500);
    const app = await gateway([broken.url], 2);

    const res = await app.inject({ method: "GET", url: "/api/items" });

    expect(res.statusCode).toBe(500);
    expect(broken.state.hits).toBe(3);
  });

  it("retries connection errors for GET", async () => {
    const healthy = await countingUpstream(() => 200);
    const app = await gateway(["http://127.0.0.1:1", healthy.url], 1);

    const res = await app.inject({ method: "GET", url: "/api/items" });

    expect(res.statusCode).toBe(200);
  });

  it("never retries a POST", async () => {
    const broken = await countingUpstream(() => 503);
    const healthy = await countingUpstream(() => 200);
    const app = await gateway([broken.url, healthy.url], 3);

    const res = await app.inject({ method: "POST", url: "/api/items", payload: { a: 1 } });

    expect(res.statusCode).toBe(503);
    expect(broken.state.hits).toBe(1);
    expect(healthy.state.hits).toBe(0);
  });
});
