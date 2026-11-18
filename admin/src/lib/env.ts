// Runtime accessors for Cloudflare Pages bindings (D1, vars and secrets).
// Pages' platform.env is typed as Record<string, any>; we narrow it here.

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
  /** The bucket's object at `file` (workers/image/src/stat.ts). */
  stat(
    accessJwt: string | null,
    file: string,
  ): Promise<
    | {
        ok: true;
        stat: {
          size: number;
          etag: string | null;
          sha256: string | null;
        } | null;
      }
    | { ok: false; status: number }
  >;
  /**
   * Up to 256 KiB of the original at `file`: from `offset`, or its last
   * `suffix` bytes (workers/image/src/bytes.ts). `object` null: no such
   * object.
   */
  bytes(
    accessJwt: string | null,
    file: string,
    range: { offset: number; length: number } | { suffix: number },
  ): Promise<
    | { ok: true; object: { bytes: Uint8Array; size: number } | null }
    | { ok: false; status: number }
  >;
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
