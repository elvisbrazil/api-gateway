import Fastify, { type FastifyServerOptions } from "fastify";
import type { GatewayConfig } from "./config/schema.js";
import { proxyRoutes } from "./proxy/proxy-routes.js";

export interface AppOptions {
  config: GatewayConfig;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", () => ({ status: "ok" }));

  await app.register(proxyRoutes, { config: options.config });

  await app.ready();
  return app;
}
