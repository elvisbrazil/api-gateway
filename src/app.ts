import Fastify, { type FastifyServerOptions } from "fastify";
import type { GatewayConfig } from "./config/schema.js";
import { proxyRoutes } from "./proxy/proxy-routes.js";
import { requestId } from "./request-id.js";

export interface AppOptions {
  config: GatewayConfig;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: false,
    genReqId: requestId,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health", () => ({ status: "ok" }));

  await app.register(proxyRoutes, { config: options.config });

  await app.ready();
  return app;
}
