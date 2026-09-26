import type { RateLimitPolicy } from "../config/schema.js";
import type { RateLimitStore } from "./store.js";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly now: () => number = Date.now,
  ) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const { windowMs, limit } = policy;
    const now = this.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetMs = windowStart + windowMs - now;

    let count = await this.store.increment(`${key}:${windowStart}`, windowMs * 2);
    if (policy.algorithm === "sliding") {
      const previous = await this.store.get(`${key}:${windowStart - windowMs}`);
      count += Math.floor(previous * (resetMs / windowMs));
    }

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetMs,
    };
  }
}
