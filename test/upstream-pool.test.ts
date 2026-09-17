import { describe, expect, it } from "vitest";
import { UpstreamPool } from "../src/resilience/upstream-pool.js";

const urls = ["http://a", "http://b", "http://c"];

function pick(pool: UpstreamPool, times: number) {
  return Array.from({ length: times }, () => pool.next()?.url);
}

function openCircuit(pool: UpstreamPool, url: string) {
  const target = pool.targets.find((t) => t.url === url);
  target?.breaker.recordFailure();
}

describe("UpstreamPool", () => {
  it("rotates through targets in order", () => {
    const pool = new UpstreamPool(urls, { failureThreshold: 1, cooldownMs: 1_000 });

    expect(pick(pool, 4)).toEqual(["http://a", "http://b", "http://c", "http://a"]);
  });

  it("skips targets whose circuit is open", () => {
    const pool = new UpstreamPool(urls, { failureThreshold: 1, cooldownMs: 1_000 });
    openCircuit(pool, "http://b");

    expect(pick(pool, 4)).toEqual(["http://a", "http://c", "http://a", "http://c"]);
  });

  it("returns nothing when every circuit is open", () => {
    const pool = new UpstreamPool(urls, { failureThreshold: 1, cooldownMs: 1_000 });
    urls.forEach((url) => {
      openCircuit(pool, url);
    });

    expect(pool.next()).toBeUndefined();
  });

  it("brings a target back after its cooldown", () => {
    let now = 0;
    const pool = new UpstreamPool(urls, { failureThreshold: 1, cooldownMs: 1_000 }, () => now);
    openCircuit(pool, "http://a");
    expect(pick(pool, 2)).toEqual(["http://b", "http://c"]);

    now = 1_000;

    expect(pick(pool, 1)).toEqual(["http://a"]);
  });
});
