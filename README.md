# api-gateway

A small API gateway on Fastify. Routes are declared in a YAML (or JSON) file and each one maps a
path prefix to one or more upstream services, with optional JWT auth, rate limiting, retries,
timeouts and response caching.

What it does:

- Proxies requests with `@fastify/reply-from` (undici), keeping method, body and headers.
- Adds `X-Request-Id` (propagated when valid, generated otherwise) and `X-Forwarded-For/Proto/Host`,
  and drops hop-by-hop headers in both directions.
- Verifies bearer tokens against a JWKS URL with `jose`, checks per-route scopes and forwards the
  user to the upstream as `X-User-Id` / `X-User-Scopes`.
- Rate limits per IP, API key or user with a fixed or sliding window, backed by Redis (or memory).
- Keeps a circuit breaker per upstream and round-robins across targets, skipping open circuits.
- Caches GET responses in an in-memory LRU for the route's TTL.
- Exposes `/health` and Prometheus metrics at `/metrics`.

## Running

Everything, including the gateway, with Docker:

```sh
docker compose up -d --build
```

This starts Redis, a dev token issuer (`examples/dev-auth.js`), a users service, two replicas of an
orders service and the gateway on port 8080, configured by `examples/gateway.docker.yaml`.

To work on the gateway itself, keep the compose stack up and run it locally on port 3000 using
`gateway.yaml`:

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Checks:

```sh
pnpm test
pnpm lint && pnpm format:check && pnpm typecheck && pnpm build
```

Tests start real upstream Fastify instances on random ports and a local JWKS server, so they need
neither Docker nor Redis.

## Trying it out

```sh
# public route, round-robin between orders-a and orders-b, cached for 10s
curl -i localhost:8080/api/orders

# no-store responses skip the cache
curl -i localhost:8080/api/orders/live

# upstream slower than the 2s route timeout -> 504
curl -i localhost:8080/api/orders/slow

# 5 requests per 10s per IP, the 6th gets 429 with Retry-After
for i in $(seq 6); do curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/api/orders; done

# protected route: get a token from the dev issuer first
TOKEN=$(curl -s localhost:4000/token -H 'content-type: application/json' \
  -d '{"sub":"user-42","scope":"users:read"}' | jq -r .access_token) # needs jq
curl -i localhost:8080/api/users/me -H "authorization: Bearer $TOKEN"

curl localhost:8080/metrics
```

## Route config

```yaml
auth:
  jwksUrl: http://auth:4000/.well-known/jwks.json
  issuer: dev-auth
  audience: api-gateway

circuitBreaker:
  failureThreshold: 3
  cooldownMs: 15000

routes:
  - prefix: /api/orders
    upstreams: [http://orders-a:4002, http://orders-b:4002]
    stripPrefix: true # default
    auth: { required: false } # set scopes to require auth
    timeoutMs: 2000
    retries: 1 # GET, HEAD and OPTIONS only
    cacheTtlMs: 10000
    rateLimit: { limit: 5, windowMs: 10000, algorithm: fixed, key: ip }
```

The file is validated with zod at startup, so a typo or a route that asks for auth without a JWKS
URL stops the process with a readable error.

## Layout

```
src/
  config/       zod schema and yaml/json loader
  proxy/        route registration, forwarding, header handling
  auth/         JWKS-backed JWT verifier and the per-route auth hook
  rate-limit/   limiter, store port, memory and Redis stores
  resilience/   circuit breaker and round-robin upstream pool
  cache/        LRU response cache
  metrics.ts    prom-client registry and /metrics
examples/       demo upstreams, dev token issuer, docker gateway config
```

## Design notes

- Retries run in the gateway rather than through reply-from's own retry option, so a retry can
  move to the next upstream in the pool. They only apply to idempotent methods, which also means
  there is never a request body to replay.
- A 5xx response or a connection error counts as a failure for the circuit breaker; 4xx does not.
  Half-open lets exactly one trial request through and goes back to open if it fails.
- The sliding window is the two-counter approximation (previous window weighted by overlap) rather
  than a log of timestamps. It costs two keys per client instead of one entry per request.
- The Redis store only needs an atomic `INCR` + `PEXPIRE`, done in a small Lua script. Everything
  else in the limiter is plain arithmetic and is shared with the in-memory store used in tests.
- Upstream timeouts use undici's headers/body timeouts. undici runs those on a coarse timer, so
  very short timeouts (under a second) can fire late.
- Cached entries for authenticated routes are keyed by user as well as URL. Responses with
  `Cache-Control: no-store` or `private`, or with `Set-Cookie`, are never stored.
- Client-supplied `X-User-*` headers are always removed before proxying, so upstreams can trust them.
