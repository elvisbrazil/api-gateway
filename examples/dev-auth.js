import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const issuer = process.env.ISSUER ?? "dev-auth";
const audience = process.env.AUDIENCE ?? "api-gateway";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "dev", alg: "RS256", use: "sig" };

const app = Fastify({ logger: true });

app.get("/.well-known/jwks.json", () => ({ keys: [jwk] }));

app.post("/token", async (request) => {
  const { sub = "user-1", scope = "" } = request.body ?? {};
  const token = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", kid: "dev" })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return { access_token: token, token_type: "Bearer", expires_in: 3600 };
});

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4000) });
