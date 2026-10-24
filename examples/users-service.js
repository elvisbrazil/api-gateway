import Fastify from "fastify";

const app = Fastify({ logger: true });

const users = new Map([
  ["1", { id: "1", name: "Ana Souza", email: "ana@example.com" }],
  ["2", { id: "2", name: "Bruno Lima", email: "bruno@example.com" }],
]);

app.get("/", () => [...users.values()]);

app.get("/me", (request, reply) => {
  const id = request.headers["x-user-id"];
  if (!id) return reply.code(401).send({ error: "no user" });
  return { id, scopes: String(request.headers["x-user-scopes"] ?? "").split(" ") };
});

app.get("/:id", (request, reply) => {
  const user = users.get(request.params.id);
  return user ?? reply.code(404).send({ error: "user not found" });
});

app.post("/", (request, reply) => {
  const id = String(users.size + 1);
  const user = { id, ...request.body };
  users.set(id, user);
  return reply.code(201).send(user);
});

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4001) });
