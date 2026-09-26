import { beforeEach, describe, expect, it } from "vitest";
import type { RateLimitPolicy } from "../src/config/schema.js";
import { MemoryRateLimitStore } from "../src/rate-limit/memory-store.js";
import { RateLimiter } from "../src/rate-limit/rate-limiter.js";

describe("RateLimiter", () => {
  let now: number;
  let limiter: RateLimiter;

  beforeEach(() => {
    now = 10_000;
    limiter = new RateLimiter(new MemoryRateLimitStore(() => now), () => now);
  });

  async function consume(times: number, policy: RateLimitPolicy, key = "client") {
    const results = [];
    for (let i = 0; i < times; i++) results.push(await limiter.consume(key, policy));
    return results;
  }

  describe("fixed window", () => {
    const policy: RateLimitPolicy = { limit: 3, windowMs: 1_000, algorithm: "fixed", key: "ip" };

    it("allows up to the limit and counts down remaining", async () => {
      const results = await consume(4, policy);

      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
      expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    });

    it("reports the time left in the current window", async () => {
      now = 10_250;

      const [result] = await consume(1, policy);

      expect(result?.resetMs).toBe(750);
    });

    it("starts over in the next window", async () => {
      await consume(3, policy);

      now = 11_000;
      const [result] = await consume(1, policy);

      expect(result).toMatchObject({ allowed: true, remaining: 2 });
    });

    it("keeps separate counters per key", async () => {
      await consume(3, policy, "a");

      const [result] = await consume(1, policy, "b");

      expect(result?.allowed).toBe(true);
    });
  });

  describe("sliding window", () => {
    const policy: RateLimitPolicy = { limit: 4, windowMs: 1_000, algorithm: "sliding", key: "ip" };

    it("weights the previous window by how much of it still overlaps", async () => {
      await consume(4, policy);

      now = 11_250;
      const early = await consume(2, policy);
      expect(early.map((r) => r.allowed)).toEqual([true, false]);

      now = 11_750;
      const later = await consume(2, policy);
      expect(later.map((r) => r.allowed)).toEqual([true, false]);
    });

    it("forgets windows older than the previous one", async () => {
      await consume(4, policy);

      now = 12_100;
      const [result] = await consume(1, policy);

      expect(result).toMatchObject({ allowed: true, remaining: 3 });
    });
  });
});
