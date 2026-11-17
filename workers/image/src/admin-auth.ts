/**
 * Cloudflare Access check for the AdminImage entrypoint (tested with
 * Vitest).
 *
 * The admin's /thumb route passes on the `Cf-Access-Jwt-Assertion` of the
 * request it is serving, and the Worker verifies it itself before serving
 * any image: being bound to the entrypoint is not enough. Same rules as
 * the admin's own check (admin/src/lib/access.ts): RS256 signature against
 * the team's JWKS, `iss` = the team domain, `aud` one of the admin's Access
 * applications, `exp` required (and `nbf` honoured). There is no bypass:
 * local and E2E runs never call the real entrypoint.
 */
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export type AccessConfig = {
  /** Team domain URL, also the JWT `iss`. */
  issuer: string;
  /** AUD tags of the admin's Access applications. */
  audiences: string[];
};

export type AuthResult =
  { ok: true } | { ok: false; status: 403 | 500 | 503; reason: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** ACCESS_TEAM_DOMAIN / ACCESS_AUD; null if incomplete (fail closed). */
export const parseAccessConfig = (env: {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}): AccessConfig | null => {
  const issuer = str(env.ACCESS_TEAM_DOMAIN).replace(/\/+$/, "");
  const audiences = str(env.ACCESS_AUD)
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (!/^https:\/\/[^/]+$/.test(issuer) || audiences.length === 0) {
    return null;
  }
  return { issuer, audiences };
};

const remoteJwks = new Map<string, JWTVerifyGetKey>();

/** The team's JWKS, cached per isolate (jose caches and rotates keys). */
const accessJwks = (issuer: string): JWTVerifyGetKey => {
  let jwks = remoteJwks.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    remoteJwks.set(issuer, jwks);
  }
  return jwks;
};

export const verifyAdminToken = async (
  token: string | null | undefined,
  config: AccessConfig | null,
  /** Injected for tests; defaults to the team's remote JWKS. */
  getKey?: JWTVerifyGetKey,
  /** Seconds since epoch; injected for tests. */
  now?: number,
): Promise<AuthResult> => {
  if (!config) {
    return { ok: false, status: 500, reason: "Access not configured" };
  }
  if (!token) return { ok: false, status: 403, reason: "missing token" };
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
    // No signing keys (JWKS fetch failed): infrastructure, not a bad token.
    if (e instanceof errors.JWKSTimeout || !(e instanceof errors.JOSEError)) {
      return { ok: false, status: 503, reason: "Access key lookup failed" };
    }
    return {
      ok: false,
      status: 403,
      reason: `invalid token: ${e instanceof Error ? e.name : "unknown"}`,
    };
  }
};
