import replyFrom from "@fastify/reply-from";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GatewayConfig, RouteConfig } from "../config/schema.js";
import { UpstreamPool, type UpstreamTarget } from "../resilience/upstream-pool.js";
import { stripHopByHop, upstreamRequestHeaders } from "./headers.js";
import { buildTargetUrl } from "./target-url.js";

export async function proxyRoutes(app: FastifyInstance, opts: { config: GatewayConfig }) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });

  await app.register(replyFrom, { disableCache: true, disableRequestLogging: true });

  for (const route of opts.config.routes) {
    const pool = new UpstreamPool(route.upstreams, opts.config.circuitBreaker);
    registerRoute(app, route, pool);
  }
}

function registerRoute(app: FastifyInstance, route: RouteConfig, pool: UpstreamPool) {
  const paths = route.prefix === "/" ? ["/", "/*"] : [route.prefix, `${route.prefix}/*`];

  for (const url of paths) {
    app.all(url, (request, reply) => {
      const target = pool.next();
      if (!target) {
        return reply
          .code(503)
          .send({ error: "Service Unavailable", message: "no healthy upstream available" });
      }
      return forward(request, reply, route, target);
    });
  }
}

function forward(
  request: FastifyRequest,
  reply: FastifyReply,
  route: RouteConfig,
  target: UpstreamTarget,
) {
  const url = buildTargetUrl(target.url, route.prefix, request.url, route.stripPrefix);

  return reply.from(url, {
    timeout: route.timeoutMs,
    rewriteRequestHeaders: (_req, headers) => upstreamRequestHeaders(request, headers),
    rewriteHeaders: stripHopByHop,
    onResponse: (_req, res, upstream) => {
      if (upstream.statusCode >= 500) target.breaker.recordFailure();
      else target.breaker.recordSuccess();
      res.send(upstream.stream);
    },
    onError: (res, { error }) => {
      target.breaker.recordFailure();
      request.log.warn({ err: error, upstream: target.url }, "upstream request failed");
      if (isTimeout(error)) {
        res.code(504).send({
          error: "Gateway Timeout",
          message: `upstream did not respond within ${route.timeoutMs}ms`,
        });
        return;
      }
      res.code(502).send({ error: "Bad Gateway", message: "upstream request failed" });
    },
  });
}

function isTimeout(error: Error) {
  return "statusCode" in error && error.statusCode === 504;
}
