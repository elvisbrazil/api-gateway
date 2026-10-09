import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthUser {
  id: string;
  scopes: string[];
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

export interface JwtVerifierOptions {
  jwksUrl: string;
  issuer?: string;
  audience?: string;
  cacheMaxAgeMs?: number;
}

export class InvalidTokenError extends Error {}

export function createJwtVerifier(options: JwtVerifierOptions): TokenVerifier {
  const keys = createRemoteJWKSet(new URL(options.jwksUrl), {
    cacheMaxAge: options.cacheMaxAgeMs ?? 10 * 60_000,
    cooldownDuration: 30_000,
  });

  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.audience,
      });
      if (!payload.sub) throw new InvalidTokenError("token has no subject");
      return { id: payload.sub, scopes: readScopes(payload) };
    },
  };
}

function readScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((s) => typeof s === "string");
  return [];
}
