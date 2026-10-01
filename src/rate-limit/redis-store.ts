import type { Redis, Result } from "ioredis";
import type { RateLimitStore } from "./store.js";

declare module "ioredis" {
  interface RedisCommander<Context> {
    rateLimitIncrement(key: string, ttlMs: number): Result<number, Context>;
  }
}

const INCREMENT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = "ratelimit:",
  ) {
    redis.defineCommand("rateLimitIncrement", { numberOfKeys: 1, lua: INCREMENT_SCRIPT });
  }

  increment(key: string, ttlMs: number): Promise<number> {
    return this.redis.rateLimitIncrement(this.keyPrefix + key, ttlMs);
  }

  async get(key: string): Promise<number> {
    const value = await this.redis.get(this.keyPrefix + key);
    return value ? Number(value) : 0;
  }

  async close() {
    await this.redis.quit();
  }
}
