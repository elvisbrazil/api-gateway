import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser, TokenVerifier } from "./jwt-verifier.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

export function authHook(verifier: TokenVerifier, requiredScopes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = BEARER.exec(request.headers.authorization ?? "")?.[1];
    if (!token) {
      return reply
        .code(401)
        .header("www-authenticate", 'Bearer realm="api-gateway"')
        .send({ error: "Unauthorized", message: "missing bearer token" });
    }

    try {
      request.user = await verifier.verify(token);
    } catch (err) {
      request.log.debug({ err }, "token rejected");
      return reply
        .code(401)
        .header("www-authenticate", 'Bearer realm="api-gateway", error="invalid_token"')
        .send({ error: "Unauthorized", message: "invalid or expired token" });
    }

    const granted = new Set(request.user.scopes);
    const missing = requiredScopes.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      return reply
        .code(403)
        .header("www-authenticate", 'Bearer realm="api-gateway", error="insufficient_scope"')
        .send({ error: "Forbidden", message: `missing scopes: ${missing.join(", ")}` });
    }
  };
}
