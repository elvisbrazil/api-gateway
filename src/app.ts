import Fastify, { type FastifyServerOptions } from "fastify";

export interface AppOptions {
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", () => ({ status: "ok" }));

  await app.ready();
  return app;
}
