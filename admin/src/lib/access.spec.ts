import { beforeAll, describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import { checkAccess, parseAccessConfig } from "./access";

const TEAM = "https://team.cloudflareaccess.com";
const AUD_PROD = "aud-prod";
const AUD_PREVIEW = "aud-preview";
const NOW = 1_800_000_000; // fixed clock (seconds)

let jwks: JWTVerifyGetKey;
let sign: (claims: {
  iss?: string;
  aud?: string;
  exp?: number | null;
  key?: CryptoKey;
}) => Promise<string>;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  otherKey = other.privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
  sign = ({
    iss = TEAM,
    aud = AUD_PROD,
    exp = NOW + 600,
    key = privateKey,
  }) => {
    const jwt = new SignJWT({ email: "owner@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt(NOW - 60);
    if (exp !== null) jwt.setExpirationTime(exp);
    return jwt.sign(key);
  };
});

const env = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: `${AUD_PROD}, ${AUD_PREVIEW}`,
};

const run = (
  headers: Record<string, string>,
  e: Record<string, unknown> = env,
  opts: { dev?: boolean; url?: string; getKey?: JWTVerifyGetKey } = {},
) =>
  checkAccess({
    url: new URL(opts.url ?? "https://admin.gallery.sksat.net/media/"),
    headers: new Headers(headers),
    env: e,
    dev: opts.dev ?? false,
    getKey: opts.getKey ?? jwks,
    now: NOW,
  });

describe("parseAccessConfig", () => {
  it("splits and trims the audience list", () => {
    expect(parseAccessConfig(env)).toEqual({
      issuer: TEAM,
      audiences: [AUD_PROD, AUD_PREVIEW],
    });
  });

  it("is null (fail closed) when either value is missing or blank", () => {
    expect(parseAccessConfig({ ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(
      parseAccessConfig({ ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: AUD_PROD }),
    ).toBeNull();
    expect(
      parseAccessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: " , " }),
    ).toBeNull();
  });
});

describe("checkAccess", () => {
  it("allows a valid token for either configured application", async () => {
    expect(await run({ "cf-access-jwt-assertion": await sign({}) })).toEqual({
      ok: true,
    });
    expect(
      await run({
        "cf-access-jwt-assertion": await sign({ aud: AUD_PREVIEW }),
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a request without a token (e.g. the unprotected *.pages.dev host)", async () => {
    expect(await run({})).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects tokens for another application, issuer, signer or past expiry", async () => {
    const bad = [
      await sign({ aud: "someone-elses-app" }),
      await sign({ iss: "https://evil.cloudflareaccess.com" }),
      await sign({ key: otherKey }),
      await sign({ exp: NOW - 1 }),
      await sign({ exp: null }), // no expiry at all
      "not-a-jwt",
    ];
    for (const token of bad) {
      expect(await run({ "cf-access-jwt-assertion": token })).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });

  it("rejects an unsigned (alg: none) token", async () => {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none" })}.${b64({ iss: TEAM, aud: AUD_PROD, exp: NOW + 600 })}.`;
    expect(await run({ "cf-access-jwt-assertion": none })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("does not accept the token from the CF_Authorization cookie alone", async () => {
    // Access always injects the header on proxied requests; a cookie-only
    // request means it did not pass through Access.
    const token = await sign({});
    expect(await run({ cookie: `CF_Authorization=${token}` })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("fails closed with 500 when the deployment is missing its config", async () => {
    const token = await sign({});
    expect(await run({ "cf-access-jwt-assertion": token }, {})).toMatchObject({
      ok: false,
      status: 500,
    });
  });

  it("reports a JWKS lookup failure as 503, not as a bad token", async () => {
    const token = await sign({});
    const unreachable: JWTVerifyGetKey = () => {
      throw new TypeError("fetch failed");
    };
    expect(
      await run({ "cf-access-jwt-assertion": token }, env, {
        getKey: unreachable,
      }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("is bypassed only by the Vite dev server or ACCESS_DISABLED=1 on loopback", async () => {
    expect(await run({}, {}, { dev: true })).toEqual({ ok: true });
    for (const url of ["http://localhost:5175/", "http://127.0.0.1:8788/"]) {
      expect(await run({}, { ACCESS_DISABLED: "1" }, { url })).toEqual({
        ok: true,
      });
    }
    // a stray ACCESS_DISABLED secret in production must not open the site
    expect(await run({}, { ...env, ACCESS_DISABLED: "1" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      await run(
        {},
        { ...env, ACCESS_DISABLED: "1" },
        { url: "https://admin-gallery-sksat-net.pages.dev/" },
      ),
    ).toMatchObject({ ok: false, status: 403 });
    // anything else is not an opt-out
    expect(await run({}, { ...env, ACCESS_DISABLED: "true" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await run({}, { ...env, ACCESS_DISABLED: "" })).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
