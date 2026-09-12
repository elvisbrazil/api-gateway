import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { gatewayConfig } from "./support/config.js";

describe("GET /health", () => {
  it("reports ok", async () => {
    const app = await buildApp({
      config: gatewayConfig({ routes: [{ prefix: "/api", upstreams: ["http://127.0.0.1:1"] }] }),
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
