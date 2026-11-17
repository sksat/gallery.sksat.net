// Runtime accessor for Cloudflare Pages bindings (D1 + B2 secrets).
// Pages' platform.env is typed as Record<string, any>; we narrow it here.


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

/** The admin's own thumbnail route (src/routes/thumb). */
export const THUMB_BASE = "/thumb";

/** The image Worker's AdminImage entrypoint (service binding `IMAGES`). */
export type AdminImages = {
  image(
    accessJwt: string | null,
    file: string,
    preset: string,
    accept: string | null,
  ): Promise<Response>;
};

/** The `IMAGES` binding, or null when it is not bound. */
export const getAdminImages = (
  platform: { env?: Record<string, unknown> } | undefined,
): AdminImages | null =>
  (platform?.env?.IMAGES as AdminImages | undefined) ?? null;

/**
 * Base URL for thumbnails: the /thumb route when thumbnails are on
 * (THUMBNAILS=1) and the image Worker is bound, else null for placeholders.
 * Read at request time and handed to the page via routeLoader$.
 */
export const getImageBase = (
  platform: { env?: Record<string, unknown> } | undefined,
): string | null =>
  platform?.env?.THUMBNAILS === "1" && getAdminImages(platform)
    ? THUMB_BASE
    : null;

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
