// Cloudflare Access JWT verification (defence in depth).
//
// Access fronts admin.gallery.sksat.net and preview deployments, but the
// production `admin-gallery-sksat-net.pages.dev` hostname is NOT covered by
// any Access application and served the dashboard unauthenticated. Every SSR
// and API request therefore verifies the `Cf-Access-Jwt-Assertion` header
// that Access injects on proxied requests; anything that did not pass
// through Access (no header, or a token for another app) is rejected.
//
// Fail closed: a deployment missing ACCESS_TEAM_DOMAIN / ACCESS_AUD returns
// 500 rather than serving unauthenticated. The only bypasses are the Vite dev
// server (`import.meta.env.DEV`, statically false in production builds) and
// an explicit `ACCESS_DISABLED=1` binding used by the local E2E server, which
// is honoured only for loopback hostnames so a stray production secret
// cannot open the deployment.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export type AccessConfig = {
  /** Team domain URL, also the JWT `iss`, e.g. https://team.cloudflareaccess.com */
  issuer: string;
  /** Application AUD tags accepted (production custom domain, previews). */
  audiences: string[];
};

export type AccessResult =
  { ok: true } | { ok: false; status: 403 | 500 | 503; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Read config from bindings; null if incomplete (caller must fail closed). */
export const parseAccessConfig = (
  env: Record<string, unknown>,
): AccessConfig | null => {
  const issuer = str(env.ACCESS_TEAM_DOMAIN).replace(/\/+$/, "");
  const audiences = str(env.ACCESS_AUD)
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (issuer === "" || audiences.length === 0) return null;
  return { issuer, audiences };
};

const remoteJwks = new Map<string, JWTVerifyGetKey>();

/** JWKS for the team, cached per isolate (jose also caches/rotates keys). */
export const accessJwks = (issuer: string): JWTVerifyGetKey => {
  let jwks = remoteJwks.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    remoteJwks.set(issuer, jwks);
  }
  return jwks;
};

export const checkAccess = async ({
  url,
  headers,
  env,
  dev,
  getKey,
  now,
}: {
  /** request URL; its hostname gates ACCESS_DISABLED */
  url: URL;
  headers: Headers;
  env: Record<string, unknown>;
  /** true only under the Vite dev server */
  dev: boolean;
  /** injected for tests; defaults to the team's remote JWKS */
  getKey?: JWTVerifyGetKey;
  /** seconds since epoch; injected for tests */
  now?: number;
}): Promise<AccessResult> => {
  if (dev) return { ok: true };
  if (env.ACCESS_DISABLED === "1" && LOOPBACK.has(url.hostname)) {
    return { ok: true };
  }

  const config = parseAccessConfig(env);
  if (!config) {
    return {
      ok: false,
      status: 500,
      reason: "ACCESS_TEAM_DOMAIN / ACCESS_AUD not configured",
    };
  }

  const token = headers.get("cf-access-jwt-assertion");
  if (!token) {
    return { ok: false, status: 403, reason: "missing Access token" };
  }

  try {
    await jwtVerify(token, getKey ?? accessJwks(config.issuer), {
      issuer: config.issuer,
      audience: config.audiences,
      algorithms: ["RS256"],
      requiredClaims: ["exp"],
      currentDate: now === undefined ? undefined : new Date(now * 1000),
    });
    return { ok: true };
  } catch (e) {
    // Could not obtain signing keys (JWKS fetch timed out / network error):
    // an infrastructure problem, not a bad token.
    if (e instanceof errors.JWKSTimeout || !(e instanceof errors.JOSEError)) {
      return {
        ok: false,
        status: 503,
        reason: `Access key lookup failed: ${e instanceof Error ? e.name : "unknown"}`,
      };
    }
    return {
      ok: false,
      status: 403,
      reason: `invalid Access token: ${e instanceof Error ? e.name : "unknown"}`,
    };
  }
};
