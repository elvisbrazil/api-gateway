import type { IncomingHttpHeaders } from "node:http";
import replyFrom from "@fastify/reply-from";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from "fastify";
import { authHook } from "../auth/auth-hook.js";
import type { TokenVerifier } from "../auth/jwt-verifier.js";
import type { GatewayConfig, RouteConfig } from "../config/schema.js";
import { rateLimitHook } from "../rate-limit/hook.js";
import type { RateLimiter } from "../rate-limit/rate-limiter.js";
import { UpstreamPool, type UpstreamTarget } from "../resilience/upstream-pool.js";
import { downstreamResponseHeaders, upstreamRequestHeaders } from "./headers.js";
import { buildTargetUrl } from "./target-url.js";

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface ProxyContext {
  request: FastifyRequest;
  reply: FastifyReply;
  route: RouteConfig;
  pool: UpstreamPool;
}

export interface ProxyRoutesOptions {
  config: GatewayConfig;
  rateLimiter: RateLimiter;
  tokenVerifier?: TokenVerifier;
}

export async function proxyRoutes(app: FastifyInstance, opts: ProxyRoutesOptions) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });

  app.decorateRequest("user", null);
  await app.register(replyFrom, { disableCache: true, disableRequestLogging: true });

  for (const route of opts.config.routes) {
    const pool = new UpstreamPool(route.upstreams, opts.config.circuitBreaker);
    const onRequest: onRequestAsyncHookHandler[] = [];
    if (route.auth.required) {
      if (!opts.tokenVerifier) throw new Error(`route ${route.prefix} requires auth`);
      onRequest.push(authHook(opts.tokenVerifier, route.auth.scopes));
    }
    if (route.rateLimit) {
      onRequest.push(rateLimitHook(opts.rateLimiter, route.rateLimit, route.prefix));
    }
    registerRoute(app, route, pool, onRequest);
  }
}

function registerRoute(
  app: FastifyInstance,
  route: RouteConfig,
  pool: UpstreamPool,
  onRequest: onRequestAsyncHookHandler[],
) {
  const paths = route.prefix === "/" ? ["/", "/*"] : [route.prefix, `${route.prefix}/*`];

  for (const url of paths) {
    app.all(url, { onRequest }, (request, reply) => {
      const target = pool.next();
      if (!target) {
        return reply
          .code(503)
          .send({ error: "Service Unavailable", message: "no healthy upstream available" });
      }
      return forward({ request, reply, route, pool }, target, 0);
    });
  }
}

function forward(ctx: ProxyContext, target: UpstreamTarget, attempt: number) {
  const { request, reply, route } = ctx;
  const url = buildTargetUrl(target.url, route.prefix, request.url, route.stripPrefix);
  let copiedHeaders: IncomingHttpHeaders = {};

  const retryTarget = () => {
    const canRetry = IDEMPOTENT_METHODS.has(request.method) && attempt < route.retries;
    return canRetry ? ctx.pool.next() : undefined;
  };

  return reply.from(url, {
    timeout: route.timeoutMs,
    retryDelay: () => null,
    rewriteRequestHeaders: (_req, headers) => upstreamRequestHeaders(request, headers),
    rewriteHeaders: (headers) => {
      copiedHeaders = downstreamResponseHeaders(headers);
      return copiedHeaders;
    },
    onResponse: (_req, res, upstream) => {
      if (upstream.statusCode < 500) {
        target.breaker.recordSuccess();
        res.send(upstream.stream);
        return;
      }

      target.breaker.recordFailure();
      const next = retryTarget();
      if (!next) {
        res.send(upstream.stream);
        return;
      }
      upstream.stream.resume();
      for (const name of Object.keys(copiedHeaders)) res.removeHeader(name);
      request.log.info({ upstream: target.url, status: upstream.statusCode, attempt }, "retrying");
      void forward(ctx, next, attempt + 1);
    },
    onError: (res, { error }) => {
      target.breaker.recordFailure();
      request.log.warn({ err: error, upstream: target.url, attempt }, "upstream request failed");

      const next = retryTarget();
      if (next) {
        void forward(ctx, next, attempt + 1);
        return;
      }
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
