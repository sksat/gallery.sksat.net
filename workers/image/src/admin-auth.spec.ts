import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAccessConfig, verifyAdminToken } from "./admin-auth";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "aud-admin";
const NOW = 1_800_000_000;
const config = { issuer: TEAM, audiences: [AUD, "aud-preview"] };

let jwks: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

const sign = (
  claims: {
    iss?: string;
    aud?: string;
    exp?: number | null;
    nbf?: number;
    key?: CryptoKey;
  } = {},
) => {
  const { iss = TEAM, aud = AUD, exp = NOW + 600, nbf, key } = claims;
  const jwt = new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(NOW - 60);
  if (exp !== null) jwt.setExpirationTime(exp);
  if (nbf !== undefined) jwt.setNotBefore(nbf);
  return jwt.sign(key ?? privateKey);
};

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

const verify = (token: string | null, cfg = config) =>
  verifyAdminToken(token, cfg, jwks, NOW);

describe("verifyAdminToken", () => {
  it("accepts a valid admin token (any of the AUDs)", async () => {
    expect(await verify(await sign())).toEqual({ ok: true });
    expect(await verify(await sign({ aud: "aud-preview" }))).toEqual({
      ok: true,
    });
  });

  it("rejects a missing token", async () => {
    expect(await verify(null)).toMatchObject({ ok: false, status: 403 });
    expect(await verify("")).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects expired, not-yet-valid and exp-less tokens", async () => {
    for (const token of [
      await sign({ exp: NOW - 1 }),
      await sign({ nbf: NOW + 600 }),
      await sign({ exp: null }),
    ]) {
      expect(await verify(token)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("rejects another audience or issuer", async () => {
    expect(await verify(await sign({ aud: "aud-other" }))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      await verify(await sign({ iss: "https://evil.cloudflareaccess.com" })),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a token signed with another key, or garbage", async () => {
    expect(await verify(await sign({ key: otherKey }))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await verify("not.a.jwt")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("accepts RS256 only (no alg: none, no HMAC)", async () => {
    const claims = { iss: TEAM, aud: AUD, exp: NOW + 600 };
    const b64 = (o: object) =>
      btoa(JSON.stringify(o))
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const none = `${b64({ alg: "none" })}.${b64(claims)}.`;
    const hs256 = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .sign(new TextEncoder().encode("a-shared-secret-of-enough-length!"));
    for (const token of [none, hs256]) {
      expect(await verify(token)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("fails closed without configuration", async () => {
    expect(await verify(await sign(), null as never)).toMatchObject({
      ok: false,
      status: 500,
    });
  });
});

describe("parseAccessConfig", () => {
  it("reads the team domain and a comma-separated AUD list", () => {
    expect(
      parseAccessConfig({ ACCESS_TEAM_DOMAIN: `${TEAM}/`, ACCESS_AUD: "a, b" }),
    ).toEqual({ issuer: TEAM, audiences: ["a", "b"] });
  });

  it("is null when incomplete or not https", () => {
    expect(parseAccessConfig({})).toBeNull();
    expect(parseAccessConfig({ ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(
      parseAccessConfig({ ACCESS_TEAM_DOMAIN: "http://x", ACCESS_AUD: "a" }),
    ).toBeNull();
  });
});
