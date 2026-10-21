import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import type { CircuitState } from "./resilience/circuit-breaker.js";
import type { UpstreamPool } from "./resilience/upstream-pool.js";

declare module "fastify" {
  interface FastifyContextConfig {
    routePrefix?: string;
  }
}

const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = { closed: 0, "half-open": 1, open: 2 };

export class GatewayMetrics {
  readonly registry = new Registry();
  private readonly pools = new Map<string, UpstreamPool>();

  private readonly requests = new Counter({
    name: "gateway_requests_total",
    help: "Proxied requests by route, method and status code",
    labelNames: ["route", "method", "status"],
    registers: [this.registry],
  });

  private readonly duration = new Histogram({
    name: "gateway_request_duration_seconds",
    help: "Time spent answering proxied requests",
    labelNames: ["route", "method"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  private readonly cache = new Counter({
    name: "gateway_cache_requests_total",
    help: "Cache lookups by route and result",
    labelNames: ["route", "result"],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    const pools = this.pools;
    new Gauge({
      name: "gateway_circuit_state",
      help: "Circuit breaker state per upstream (0 closed, 1 half-open, 2 open)",
      labelNames: ["route", "upstream"],
      registers: [this.registry],
      collect() {
        for (const [route, pool] of pools) {
          for (const target of pool.targets) {
            this.set({ route, upstream: target.url }, CIRCUIT_STATE_VALUE[target.breaker.state]);
          }
        }
      },
    });
  }

  trackPool(route: string, pool: UpstreamPool) {
    this.pools.set(route, pool);
  }

  register(app: FastifyInstance) {
    app.addHook("onResponse", async (request, reply) => {
      const route = request.routeOptions.config.routePrefix;
      if (!route) return;
      const method = request.method;
      this.requests.inc({ route, method, status: reply.statusCode });
      this.duration.observe({ route, method }, reply.elapsedTime / 1000);

      const cacheResult = reply.getHeader("x-cache");
      if (typeof cacheResult === "string") {
        this.cache.inc({ route, result: cacheResult.toLowerCase() });
      }
    });

    app.get("/metrics", async (_request, reply) => {
      return reply.type(this.registry.contentType).send(await this.registry.metrics());
    });
  }
}
