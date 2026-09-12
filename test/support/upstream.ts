import type { IncomingHttpHeaders } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";

export interface Upstream {
  app: FastifyInstance;
  url: string;
  close: () => Promise<void>;
}

export interface EchoBody {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export async function startUpstream(
  setup: (app: FastifyInstance) => void = echoRoutes,
): Promise<Upstream> {
  const app = Fastify();
  setup(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("upstream has no port");
  return { app, url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

export function echoRoutes(app: FastifyInstance) {
  app.all("/*", (request): EchoBody => ({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body ?? null,
  }));
}
