/**
 * /img/world/<public_id>: the picture of a photo's VRChat world, for the
 * gallery's preview card on the world link. The API Worker's worldImage
 * RPC gives its URL on VRChat's file server, only for a public or unlisted
 * photo whose world level shows the link (workers/api/src/world.ts), so
 * this serves no other picture. It is passed on as VRChat serves it: no
 * Image Transformations (nothing counts against the free tier), kept in
 * the data centre's Cache API by its URL for a week, and sent with a
 * week's max-age. A viewer's browser never asks VRChat for it.
 */
import { PUBLIC_ID_RE } from "./request";

/** Where the pictures may come from (and be redirected to). */
export const WORLD_IMAGE_HOSTS = ["api.vrchat.cloud", "files.vrchat.cloud"];

/** How long a picture is kept in the data centre (seconds). */
export const WORLD_IMAGE_TTL = 7 * 24 * 60 * 60;
/**
 * What browsers may keep: a minute, like the API's answers, so a world
 * link hidden in the admin stops being shown soon (the data centre keeps
 * the picture itself, so this costs no fetch from VRChat).
 */
export const BROWSER_CACHE_CONTROL = "public, max-age=60";
/** The largest picture passed on (bytes); VRChat's are about 0.5 MB. */
export const WORLD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** How long VRChat's file server has to answer, redirects and all (ms). */
const FETCH_TIMEOUT_MS = 10_000;
/** The most redirects followed (api.vrchat.cloud → files.vrchat.cloud). */
const MAX_REDIRECTS = 3;
const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif)$/;

/**
 * The photo of `/img/world/<public_id>` (no query), `{ status: 400 }` with
 * a query, or null for any other path.
 */
export const parseWorldImageUrl = (
  url: URL,
): string | { status: 400 } | null => {
  const m = /^\/img\/world\/([^/]+)$/.exec(url.pathname);
  if (!m || !PUBLIC_ID_RE.test(m[1])) return null;
  return url.search === "" ? m[1] : { status: 400 };
};

/** An https URL on WORLD_IMAGE_HOSTS. */
export const isWorldImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && WORLD_IMAGE_HOSTS.includes(url.hostname)
    );
  } catch {
    return false;
  }
};

export interface WorldImageContext {
  /** The API Worker's RPC: the picture of the photo's world, or null. */
  worldImage: (publicId: string) => Promise<string | null>;
  cache: {
    match(key: string): Promise<Response | undefined>;
    put(key: string, response: Response): Promise<void>;
  };
  fetch: typeof fetch;
  waitUntil: (promise: Promise<unknown>) => void;
}

const text = (status: number, body: string, cacheControl: string) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", "Cache-Control": cacheControl },
  });

/** A body, read until `max` bytes; null (and cancelled) past that. */
const readCapped = async (
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array | null> => {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
};

/**
 * The picture at `url`: its redirects followed by hand, each checked to
 * stay on VRChat's file servers before it is fetched, and its body read
 * up to WORLD_IMAGE_MAX_BYTES. Why it failed, as text, otherwise.
 */
export const fetchPicture = async (
  url: string,
  fetchFn: typeof fetch,
): Promise<{ bytes: Uint8Array; type: string } | string> => {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let at = url;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchFn(at, { redirect: "manual", signal });
    } catch (err) {
      return `fetch failed: ${String(err)}`;
    }
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => {});
      const location = res.headers.get("Location");
      if (!location || hop >= MAX_REDIRECTS) return `redirect ${res.status}`;
      const next = new URL(location, at).href;
      if (!isWorldImageUrl(next)) return "redirect off VRChat's file servers";
      at = next;
      continue;
    }
    const type = (res.headers.get("Content-Type") ?? "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPE.test(type)) {
      void res.body?.cancel().catch(() => {});
      return `${res.status} ${type}`;
    }
    const length = Number(res.headers.get("Content-Length") ?? 0);
    if (length > WORLD_IMAGE_MAX_BYTES) {
      void res.body?.cancel().catch(() => {});
      return `too large (${length})`;
    }
    const bytes = await readCapped(res.body, WORLD_IMAGE_MAX_BYTES);
    return bytes ? { bytes, type } : "too large";
  }
};

/** Not a real host: these entries never answer a public URL. */
const cacheKey = (imageUrl: string) =>
  `https://gallery-image/world/${encodeURIComponent(imageUrl)}`;

/** GET /img/world/<public_id>. */
export const handleWorldImage = async (
  publicId: string,
  ctx: WorldImageContext,
): Promise<Response> => {
  let imageUrl: string | null;
  try {
    imageUrl = await ctx.worldImage(publicId);
  } catch (err) {
    console.error(`world image ${publicId}:`, err);
    return text(503, "Service Unavailable", "no-store");
  }
  if (!imageUrl || !isWorldImageUrl(imageUrl)) {
    return text(404, "Not Found", "public, max-age=60");
  }

  const key = cacheKey(imageUrl);
  const hit = await ctx.cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("Cache-Control", BROWSER_CACHE_CONTROL);
    res.headers.set("X-Image-Cache", "HIT");
    return res;
  }

  const got = await fetchPicture(imageUrl, ctx.fetch);
  if (typeof got === "string") {
    console.error(`world image ${publicId}: ${got}`);
    return text(502, "Bad Gateway", "no-store");
  }
  const { bytes, type } = got;
  const headers = {
    "Content-Type": type,
    "Cache-Control": BROWSER_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  ctx.waitUntil(
    ctx.cache.put(
      key,
      new Response(bytes, {
        headers: {
          ...headers,
          "Cache-Control": `public, s-maxage=${WORLD_IMAGE_TTL}`,
        },
      }),
    ),
  );
  return new Response(bytes, {
    headers: {
      ...headers,
      "X-Image-Cache": "MISS",
    },
  });
};
