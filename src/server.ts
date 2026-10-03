import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadGatewayConfig } from "./config/load.js";
import { loadEnv } from "./env.js";
import { RedisRateLimitStore } from "./rate-limit/redis-store.js";

const env = loadEnv();

const config = await loadGatewayConfig(env.GATEWAY_CONFIG);

const rateLimitStore = env.REDIS_URL
  ? new RedisRateLimitStore(new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }))
  : undefined;

const app = await buildApp({
  config,
  rateLimitStore,
  logger: {
    level: env.LOG_LEVEL,
    transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, "error during shutdown");
    process.exit(1);
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
