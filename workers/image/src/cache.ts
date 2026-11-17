/**
 * Edge cache for the public route's finished images (tested with Vitest).
 *
 * Even when Image Transformations has the resized image cached, a Worker
 * response itself is never cached by the CDN, so every request ran the
 * Worker and the transform subrequest. The public handler keeps its final
 * images in the Cache API (`caches.default`, per data centre), keyed by
 * `edgeCacheKey`: what is shown (preset, file, caption) and the negotiated
 * output format, never the presigned origin URL.
 *
 * Only the public `fetch` handler uses this, and only after it has checked
 * that the photo may be shown, so a photo made private stops being served
 * at once. The admin's `AdminImage` entrypoint never does: private photos
 * must not land in a shared cache under a public URL. `isStorable` refuses
 * anything not marked `public` as a second line of defence.
 */
import type { Caption } from "./caption";
import { outputFormat, transformFailed, type PresetName } from "./request";

/** Response header telling whether the edge cache answered (HIT/MISS). */
export const CACHE_STATUS_HEADER = "X-Image-Cache";

/**
 * Cache key for an image of `file` (a validated bucket path) at `preset`,
 * on the Worker's own `origin`. The Accept-dependent format is part of the
 * key, so browsers that differ in AVIF/WebP support get separate entries.
 * A photo by public id and by bucket path share an entry. `og` cards also
 * key on their caption, which changes with the photo's metadata.
 */
export const edgeCacheKey = (
  origin: string,
  preset: PresetName,
  file: string,
  accept: string | null,
  caption: Caption = {},
): string => {
  const url = new URL(`/img/${preset}${file}`, origin);
  url.searchParams.set("format", outputFormat(preset, accept));
  if (preset === "og") {
    if (caption.primary) url.searchParams.set("primary", caption.primary);
    if (caption.secondary) url.searchParams.set("secondary", caption.secondary);
  }
  return url.toString();
};

/**
 * Whether a finished response may go into the shared edge cache: a 200
 * marked `public` that really was transformed (a failed transform may
 * answer 200 with the untransformed original).
 */
export const isStorable = (response: Response): boolean => {
  if (response.status !== 200) return false;
  const cc = (response.headers.get("Cache-Control") ?? "").toLowerCase();
  if (!/(^|[\s,])public([\s,]|$)/.test(cc)) return false;
  if (/(^|[\s,])(private|no-store|no-cache)([\s,=]|$)/.test(cc)) return false;
  if (response.headers.has("Set-Cookie")) return false;
  return !transformFailed(response.status, response.headers.get("Cf-Resized"));
};

/** The part of the Cache API this module uses. */
export type EdgeCache = Pick<Cache, "match" | "put">;

/**
 * Answer from `cache` under `key`, or from `produce` and store the result
 * (if `store` and `isStorable`) in the background via `waitUntil`. `vary`
 * is the Vary header of the response: it is not stored (the key already
 * holds the format) and is put back on a hit. Cache failures only cost
 * the cache, never the image.
 */
export const withEdgeCache = async (
  cache: EdgeCache,
  key: string,
  vary: string | null,
  waitUntil: (promise: Promise<unknown>) => void,
  produce: () => Promise<{ response: Response; store: boolean }>,
): Promise<Response> => {
  const keyRequest = new Request(key, { method: "GET" });
  let hit: Response | undefined;
  try {
    hit = await cache.match(keyRequest);
  } catch (err) {
    console.error(`edge cache match failed for ${key}:`, err);
  }
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.delete("CF-Cache-Status");
    if (vary) response.headers.set("Vary", vary);
    response.headers.set(CACHE_STATUS_HEADER, "HIT");
    return response;
  }

  const produced = await produce();
  const response = new Response(produced.response.body, produced.response);
  response.headers.set(CACHE_STATUS_HEADER, "MISS");
  if (!produced.store || !isStorable(response)) return response;

  const copy = response.clone();
  for (const name of ["Vary", "CF-Cache-Status", CACHE_STATUS_HEADER]) {
    copy.headers.delete(name);
  }
  waitUntil(
    cache.put(keyRequest, copy).catch((err: unknown) => {
      console.error(`edge cache put failed for ${key}:`, err);
    }),
  );
  return response;
};
