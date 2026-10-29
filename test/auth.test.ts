import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";
import { AUDIENCE, ISSUER, startJwks } from "./support/jwks.js";
import { startUpstream, type EchoBody } from "./support/upstream.js";

describe("authenticated routes", () => {
  let jwks: Awaited<ReturnType<typeof startJwks>>;
  const cleanup: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    jwks = await startJwks();
  });

  afterAll(() => jwks.close());

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  async function setup(route: Record<string, unknown> = {}) {
    const upstream = await startUpstream();
    const app = await buildApp({
      config: gatewayConfig({
        auth: { jwksUrl: jwks.url, issuer: ISSUER, audience: AUDIENCE },
        routes: [
          {
            prefix: "/orders",
            upstreams: [upstream.url],
            auth: { scopes: ["orders:read"] },
            ...route,
          },
        ],
      }),
    });
    cleanup.push(() => app.close(), upstream.close);
    return app;
  }

  it("rejects requests without a bearer token", async () => {
    const app = await setup();

    const res = await app.inject({ method: "GET", url: "/orders" });

    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });

  it("rejects an invalid token", async () => {
    const app = await setup();

    const res = await app.inject({
      method: "GET",
      url: "/orders",
      headers: { authorization: "Bearer not-a-jwt" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
  });

  it("returns 403 when a required scope is missing", async () => {
    const app = await setup();
    const token = await jwks.sign({ scope: "profile" });

    const res = await app.inject({
      method: "GET",
      url: "/orders",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: "missing scopes: orders:read" });
  });

  it("forwards the user id and scopes to the upstream", async () => {
    const app = await setup();
    const token = await jwks.sign({ sub: "user-42", scope: "orders:read orders:write" });

    const res = await app.inject({
      method: "GET",
      url: "/orders/1",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<EchoBody>().headers).toMatchObject({
      "x-user-id": "user-42",
      "x-user-scopes": "orders:read orders:write",
    });
  });

  it("drops client supplied user headers", async () => {
    const app = await setup({ auth: { required: false } });

    const res = await app.inject({
      method: "GET",
      url: "/orders",
      headers: { "x-user-id": "admin", "x-user-scopes": "everything" },
    });

    const headers = res.json<EchoBody>().headers;
    expect(headers).not.toHaveProperty("x-user-id");
    expect(headers).not.toHaveProperty("x-user-scopes");
  });

  it("rate limits per user when configured", async () => {
    const app = await setup({ rateLimit: { limit: 1, windowMs: 60_000, key: "user" } });
    const alice = { authorization: `Bearer ${await jwks.sign({ sub: "alice" })}` };
    const bob = { authorization: `Bearer ${await jwks.sign({ sub: "bob" })}` };

    await app.inject({ method: "GET", url: "/orders", headers: alice });
    const aliceAgain = await app.inject({ method: "GET", url: "/orders", headers: alice });
    const bobFirst = await app.inject({ method: "GET", url: "/orders", headers: bob });

    expect(aliceAgain.statusCode).toBe(429);
    expect(bobFirst.statusCode).toBe(200);
  });

  it("does not share cached responses between users", async () => {
    const app = await setup({ cacheTtlMs: 60_000 });
    const alice = { authorization: `Bearer ${await jwks.sign({ sub: "alice" })}` };
    const bob = { authorization: `Bearer ${await jwks.sign({ sub: "bob" })}` };

    await app.inject({ method: "GET", url: "/orders/mine", headers: alice });
    const aliceAgain = await app.inject({ method: "GET", url: "/orders/mine", headers: alice });
    const bobFirst = await app.inject({ method: "GET", url: "/orders/mine", headers: bob });

    expect(aliceAgain.headers["x-cache"]).toBe("HIT");
    expect(bobFirst.headers["x-cache"]).toBe("MISS");
    expect(bobFirst.json<EchoBody>().headers["x-user-id"]).toBe("bob");
  });
});
