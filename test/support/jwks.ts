import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";

export const ISSUER = "https://auth.test";
export const AUDIENCE = "api-gateway";

export async function startJwks() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const state = { requests: 0 };

  const app = Fastify();
  app.get("/.well-known/jwks.json", () => {
    state.requests += 1;
    return { keys: [jwk] };
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("jwks server has no port");

  const sign = (claims: JWTPayload = {}, expiresIn: string | number = "5m") =>
    new SignJWT({ sub: "user-1", iss: ISSUER, aud: AUDIENCE, scope: "orders:read", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);

  return {
    url: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    state,
    sign,
    close: () => app.close(),
  };
}
