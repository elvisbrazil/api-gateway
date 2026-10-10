import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimitPolicy } from "../config/schema.js";
import type { RateLimiter } from "./rate-limiter.js";

export function rateLimitHook(limiter: RateLimiter, policy: RateLimitPolicy, prefix: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = `${prefix}:${clientKey(request, policy)}`;
    const result = await limiter.consume(key, policy);
    const resetSeconds = Math.ceil(result.resetMs / 1000);

    reply.headers({
      "ratelimit-limit": result.limit,
      "ratelimit-remaining": result.remaining,
      "ratelimit-reset": resetSeconds,
    });

    if (!result.allowed) {
      return reply
        .code(429)
        .header("retry-after", resetSeconds)
        .send({ error: "Too Many Requests", message: "rate limit exceeded" });
    }
  };
}

function clientKey(request: FastifyRequest, policy: RateLimitPolicy) {
  if (policy.key === "user" && request.user) {
    return `user:${request.user.id}`;
  }
  if (policy.key === "apiKey") {
    const apiKey = request.headers["x-api-key"];
    if (typeof apiKey === "string" && apiKey.length > 0) {
      return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 32)}`;
    }
  }
  return `ip:${request.ip}`;
}
