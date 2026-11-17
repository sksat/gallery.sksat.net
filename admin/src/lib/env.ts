// Runtime accessor for Cloudflare Pages bindings (D1 + B2 secrets).
// Pages' platform.env is typed as Record<string, any>; we narrow it here.

import { normalizeImageBase } from "./images";

export type AdminEnv = {
  DB: D1Database;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_ENDPOINT: string;
  B2_ACCESS_KEY_ID: string;
  B2_SECRET_ACCESS_KEY: string;
};

export const getDB = (
  platform: { env?: Record<string, unknown> } | undefined,
): D1Database => {
  const db = platform?.env?.DB;
  if (!db) {
    throw new Error(
      "D1 binding `DB` not found on platform.env — check wrangler.jsonc and run via `pnpm serve` (wrangler pages dev) or in production.",
    );
  }
  return db as D1Database;
};

/**
 * Image Worker base URL (IMAGE_BASE_URL var, e.g.
 * "https://gallery.sksat.net/img"), or null to show placeholders. Read on
 * the server at request time and handed to the page via routeLoader$, so
 * it is a runtime var rather than a build-time VITE_ one.
 */
export const getImageBase = (
  platform: { env?: Record<string, unknown> } | undefined,
): string | null => normalizeImageBase(platform?.env?.IMAGE_BASE_URL);

export const getB2Env = (
  platform: { env?: Record<string, unknown> } | undefined,
): Pick<
  AdminEnv,
  | "B2_REGION"
  | "B2_BUCKET"
  | "B2_ENDPOINT"
  | "B2_ACCESS_KEY_ID"
  | "B2_SECRET_ACCESS_KEY"
> => {
  const env = platform?.env ?? {};
  const required = [
    "B2_REGION",
    "B2_BUCKET",
    "B2_ENDPOINT",
    "B2_ACCESS_KEY_ID",
    "B2_SECRET_ACCESS_KEY",
  ] as const;
  // Reject empty strings as well — an empty B2_ACCESS_KEY_ID would pass a
  // bare typeof check and surface later as an opaque SigV4 failure.
  const missing = required.filter(
    (k) => typeof env[k] !== "string" || env[k] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing B2 env vars: ${missing.join(", ")}`);
  }
  return {
    B2_REGION: env.B2_REGION as string,
    B2_BUCKET: env.B2_BUCKET as string,
    B2_ENDPOINT: env.B2_ENDPOINT as string,
    B2_ACCESS_KEY_ID: env.B2_ACCESS_KEY_ID as string,
    B2_SECRET_ACCESS_KEY: env.B2_SECRET_ACCESS_KEY as string,
  };
};
