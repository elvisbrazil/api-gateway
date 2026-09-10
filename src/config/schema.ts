import { z } from "zod";

const prefix = z
  .string()
  .regex(/^\/[A-Za-z0-9._~\-/]*$/, "must start with / and contain only path characters")
  .transform((value) => (value.length > 1 ? value.replace(/\/+$/, "") : value));

const rateLimitSchema = z.object({
  limit: z.number().int().positive(),
  windowMs: z.number().int().positive(),
  algorithm: z.enum(["fixed", "sliding"]).default("fixed"),
  key: z.enum(["ip", "user", "apiKey"]).default("ip"),
});

const circuitBreakerSchema = z.object({
  failureThreshold: z.number().int().positive().default(5),
  cooldownMs: z.number().int().positive().default(10_000),
});

const routeSchema = z.object({
  prefix,
  upstreams: z.array(z.url({ protocol: /^https?$/ })).min(1),
  stripPrefix: z.boolean().default(true),
  auth: z
    .object({
      required: z.boolean().default(true),
      scopes: z.array(z.string().min(1)).default([]),
    })
    .default({ required: false, scopes: [] }),
  rateLimit: rateLimitSchema.optional(),
  timeoutMs: z.number().int().positive().default(5_000),
  retries: z.number().int().min(0).max(5).default(0),
  cacheTtlMs: z.number().int().min(0).default(0),
});

export const gatewayConfigSchema = z
  .object({
    auth: z
      .object({
        jwksUrl: z.url(),
        issuer: z.string().min(1).optional(),
        audience: z.string().min(1).optional(),
      })
      .optional(),
    circuitBreaker: circuitBreakerSchema.default({ failureThreshold: 5, cooldownMs: 10_000 }),
    routes: z.array(routeSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.routes.forEach((route, index) => {
      if (seen.has(route.prefix)) {
        ctx.addIssue({
          code: "custom",
          path: ["routes", index, "prefix"],
          message: `duplicate prefix ${route.prefix}`,
        });
      }
      seen.add(route.prefix);

      if (route.auth.required && !config.auth) {
        ctx.addIssue({
          code: "custom",
          path: ["routes", index, "auth"],
          message: "route requires auth but no auth.jwksUrl is configured",
        });
      }
      if (route.rateLimit?.key === "user" && !route.auth.required) {
        ctx.addIssue({
          code: "custom",
          path: ["routes", index, "rateLimit", "key"],
          message: "rate limiting by user needs auth.required",
        });
      }
    });
  });

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
export type RouteConfig = GatewayConfig["routes"][number];
export type RateLimitPolicy = z.infer<typeof rateLimitSchema>;
export type CircuitBreakerOptions = z.infer<typeof circuitBreakerSchema>;
