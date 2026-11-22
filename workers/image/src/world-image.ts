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

/** How long a picture is kept and may be cached by browsers (seconds). */
export const WORLD_IMAGE_TTL = 7 * 24 * 60 * 60;
/** The largest picture passed on (bytes); VRChat's are about 0.5 MB. */
export const WORLD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** How long VRChat's file server has to answer (ms). */
const FETCH_TIMEOUT_MS = 10_000;

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
    return text(404, "Not Found", "public, max-age=600");
  }

  const key = cacheKey(imageUrl);
  const hit = await ctx.cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("Cache-Control", `public, max-age=${WORLD_IMAGE_TTL}`);
    res.headers.set("X-Image-Cache", "HIT");
    return res;
  }

  let res: Response;
  try {
    res = await ctx.fetch(imageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`world image ${publicId} fetch:`, err);
    return text(502, "Bad Gateway", "no-store");
  }
  const type = res.headers.get("Content-Type") ?? "";
  const length = Number(res.headers.get("Content-Length") ?? 0);
  if (
    !res.ok ||
    // A redirect may only lead to VRChat's own file server.
    (res.url !== "" && !isWorldImageUrl(res.url)) ||
    !/^image\/(png|jpeg|webp|gif)$/.test(type.split(";")[0].trim()) ||
    length > WORLD_IMAGE_MAX_BYTES
  ) {
    void res.body?.cancel().catch(() => {});
    console.error(`world image ${publicId}: ${res.status} ${type}`);
    return text(502, "Bad Gateway", "no-store");
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > WORLD_IMAGE_MAX_BYTES) {
    return text(502, "Bad Gateway", "no-store");
  }
  const headers = {
    "Content-Type": type,
    "Cache-Control": `public, max-age=${WORLD_IMAGE_TTL}`,
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
