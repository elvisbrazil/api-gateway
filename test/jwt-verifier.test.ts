import { generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJwtVerifier, type TokenVerifier } from "../src/auth/jwt-verifier.js";
import { AUDIENCE, ISSUER, startJwks } from "./support/jwks.js";

describe("JWT verifier", () => {
  let jwks: Awaited<ReturnType<typeof startJwks>>;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    jwks = await startJwks();
    verifier = createJwtVerifier({ jwksUrl: jwks.url, issuer: ISSUER, audience: AUDIENCE });
  });

  afterAll(() => jwks.close());

  it("returns the subject and scopes of a valid token", async () => {
    const token = await jwks.sign({ scope: "orders:read orders:write" });

    await expect(verifier.verify(token)).resolves.toEqual({
      id: "user-1",
      scopes: ["orders:read", "orders:write"],
    });
  });

  it("reads scopes from an scp array", async () => {
    const token = await jwks.sign({ scope: undefined, scp: ["admin"] });

    await expect(verifier.verify(token)).resolves.toMatchObject({ scopes: ["admin"] });
  });

  it("caches the key set between verifications", async () => {
    const before = jwks.state.requests;

    await verifier.verify(await jwks.sign());
    await verifier.verify(await jwks.sign());

    expect(jwks.state.requests).toBe(before);
  });

  it("rejects an expired token", async () => {
    const token = await jwks.sign({}, Math.floor(Date.now() / 1000) - 60);

    await expect(verifier.verify(token)).rejects.toThrow(/exp/);
  });

  it("rejects a token for another audience", async () => {
    const token = await jwks.sign({ aud: "someone-else" });

    await expect(verifier.verify(token)).rejects.toThrow(/aud/);
  });

  it("rejects a token signed with an unknown key", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user-1")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toThrow(/signature/);
  });
});
