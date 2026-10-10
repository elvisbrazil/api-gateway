import Fastify, { type FastifyServerOptions } from "fastify";
import { createJwtVerifier, type TokenVerifier } from "./auth/jwt-verifier.js";
import type { GatewayConfig } from "./config/schema.js";
import { proxyRoutes } from "./proxy/proxy-routes.js";
import { MemoryRateLimitStore } from "./rate-limit/memory-store.js";
import { RateLimiter } from "./rate-limit/rate-limiter.js";
import type { RateLimitStore } from "./rate-limit/store.js";
import { requestId } from "./request-id.js";

export interface AppOptions {
  config: GatewayConfig;
  rateLimitStore?: RateLimitStore;
  tokenVerifier?: TokenVerifier;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: false,
    genReqId: requestId,
  });

  const rateLimitStore: RateLimitStore = options.rateLimitStore ?? new MemoryRateLimitStore();
  app.addHook("onClose", async () => {
    await rateLimitStore.close?.();
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health", () => ({ status: "ok" }));

  await app.register(proxyRoutes, {
    config: options.config,
    rateLimiter: new RateLimiter(rateLimitStore),
    tokenVerifier:
      options.tokenVerifier ?? (options.config.auth && createJwtVerifier(options.config.auth)),
  });

  await app.ready();
  return app;
}
