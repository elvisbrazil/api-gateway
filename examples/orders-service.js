import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";

const instance = process.env.INSTANCE ?? "orders";
const app = Fastify({ logger: true });

app.addHook("onSend", async (_request, reply) => {
  reply.header("x-served-by", instance);
});

app.get("/", () => ({
  servedBy: instance,
  generatedAt: new Date().toISOString(),
  orders: [
    { id: "o-1", total: 129.9, status: "paid" },
    { id: "o-2", total: 59.5, status: "shipped" },
  ],
}));

app.get("/live", (_request, reply) =>
  reply.header("cache-control", "no-store").send({ servedBy: instance, at: Date.now() }),
);

app.get("/slow", async () => {
  await sleep(Number(process.env.SLOW_MS ?? 5000));
  return { servedBy: instance };
});

app.get("/flaky", (_request, reply) =>
  Math.random() < 0.5
    ? reply.code(503).send({ error: "try again", servedBy: instance })
    : { servedBy: instance },
);

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4002) });
