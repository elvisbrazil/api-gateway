import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadGatewayConfig, parseGatewayConfig } from "../src/config/load.js";

const minimalRoute = { prefix: "/api", upstreams: ["http://localhost:4001"] };

describe("gateway config", () => {
  it("loads a yaml file and applies defaults", async () => {
    const config = await loadGatewayConfig(
      fileURLToPath(new URL("./fixtures/gateway.yaml", import.meta.url)),
    );

    expect(config.routes).toHaveLength(2);
    const [users, orders] = config.routes;
    expect(users?.prefix).toBe("/api/users");
    expect(users?.auth).toEqual({ required: true, scopes: ["users:read"] });
    expect(users?.rateLimit).toEqual({
      limit: 10,
      windowMs: 1000,
      algorithm: "fixed",
      key: "user",
    });
    expect(orders?.auth.required).toBe(false);
    expect(orders?.timeoutMs).toBe(5000);
    expect(orders?.stripPrefix).toBe(true);
    expect(config.circuitBreaker).toEqual({ failureThreshold: 5, cooldownMs: 10_000 });
  });

  it("rejects a route without upstreams", () => {
    expect(() => parseGatewayConfig({ routes: [{ prefix: "/api", upstreams: [] }] })).toThrow(
      /upstreams/,
    );
  });

  it("rejects non-http upstream urls", () => {
    expect(() =>
      parseGatewayConfig({ routes: [{ prefix: "/api", upstreams: ["ftp://files.local"] }] }),
    ).toThrow(/Invalid gateway config/);
  });

  it("rejects prefixes that do not start with a slash", () => {
    expect(() => parseGatewayConfig({ routes: [{ ...minimalRoute, prefix: "api" }] })).toThrow(
      /must start with \//,
    );
  });

  it("rejects duplicate prefixes", () => {
    expect(() =>
      parseGatewayConfig({ routes: [minimalRoute, { ...minimalRoute, prefix: "/api/" }] }),
    ).toThrow(/duplicate prefix \/api/);
  });

  it("requires a jwks url when a route needs auth", () => {
    expect(() =>
      parseGatewayConfig({ routes: [{ ...minimalRoute, auth: { scopes: ["admin"] } }] }),
    ).toThrow(/no auth.jwksUrl/);
  });

  it("does not allow per-user rate limits on public routes", () => {
    expect(() =>
      parseGatewayConfig({
        routes: [{ ...minimalRoute, rateLimit: { limit: 1, windowMs: 1000, key: "user" } }],
      }),
    ).toThrow(/needs auth.required/);
  });
});
