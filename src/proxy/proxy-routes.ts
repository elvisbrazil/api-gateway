import replyFrom from "@fastify/reply-from";
import type { FastifyInstance } from "fastify";
import type { GatewayConfig, RouteConfig } from "../config/schema.js";
import { buildTargetUrl } from "./target-url.js";

export async function proxyRoutes(app: FastifyInstance, opts: { config: GatewayConfig }) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });

  await app.register(replyFrom, { disableCache: true, disableRequestLogging: true });

  for (const route of opts.config.routes) {
    registerRoute(app, route);
  }
}

function registerRoute(app: FastifyInstance, route: RouteConfig) {
  const paths = route.prefix === "/" ? ["/", "/*"] : [route.prefix, `${route.prefix}/*`];
  const [upstream] = route.upstreams;
  if (!upstream) throw new Error(`route ${route.prefix} has no upstreams`);

  for (const url of paths) {
    app.all(url, (request, reply) => {
      const target = buildTargetUrl(upstream, route.prefix, request.url, route.stripPrefix);
      return reply.from(target, { timeout: route.timeoutMs });
    });
  }
}
