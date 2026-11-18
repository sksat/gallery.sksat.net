/**
 * URL → route for the public API (gallery.sksat.net/api/*). Ids are
 * checked for shape here so malformed ones never reach D1.
 */

/** Must match admin/src/lib/public-id.ts and the CHECK in migration 0003. */
export const PUBLIC_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

/** Same shape as the admin's CAMERA_SLUG_RE. */
const CAMERA_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type Route =
  | { kind: "media-list" }
  | { kind: "media"; id: string }
  | { kind: "camera-list" }
  | { kind: "camera"; slug: string };

/**
 * The route for a path, or null (404). A trailing slash is accepted.
 *
 * - `/api/media` — public photos
 * - `/api/media/<public_id>` — one public or unlisted photo
 * - `/api/camera` — every camera
 * - `/api/camera/<slug>` — one camera
 */
export const parseRoute = (pathname: string): Route | null => {
  const parts = pathname.replace(/\/$/, "").split("/");
  if (parts[0] !== "" || parts[1] !== "api") return null;
  const [, , resource, a, b, ...rest] = parts;
  if (rest.length > 0) return null;

  if (resource === "media") {
    if (a === undefined) return { kind: "media-list" };
    if (b === undefined) {
      return PUBLIC_ID_RE.test(a) ? { kind: "media", id: a } : null;
    }
    return null;
  }
  if (resource === "camera" && b === undefined) {
    if (a === undefined) return { kind: "camera-list" };
    return a.length <= 64 && CAMERA_SLUG_RE.test(a)
      ? { kind: "camera", slug: a }
      : null;
  }
  return null;
};

/**
 * Cache-Control for API responses: ten seconds in browsers (and a minute
 * in shared caches). The Worker itself keeps answers per content version
 * (last-good.ts), so a change in the admin (in particular hiding a photo)
 * is served everywhere within about a minute.
 */
export const CACHE_CONTROL = "public, max-age=10, s-maxage=60";

/** JSON response with the API's cache policy. */
export const jsonResponse = (
  status: number,
  body: unknown,
  cacheControl: string = CACHE_CONTROL,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
