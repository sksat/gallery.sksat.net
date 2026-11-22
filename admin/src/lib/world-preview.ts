// The edit page's world card (components/world-card.tsx): a photo's
// VRChat world previewed by the admin itself, by world id, at
// /api/world/<id> (its name, author and description) and
// /api/world/<id>/image (its picture). The page and the picture are read
// here, server side, with the same parser, User-Agent and limits as the
// public API and image Workers (shared/vrchat/), and kept in the data
// centre's Cache API; the browser never asks VRChat for anything. Any
// photo's world, private ones too: these routes are behind Access like
// every admin route (plugin@access.ts), and say nothing about photos.
import {
  WORLD_ID_RE,
  worldPreview,
  type PreviewCache,
  type WorldPreview,
} from "@shared/vrchat/world";
import { fetchPicture } from "@shared/vrchat/world-image";

/** What the card gets; the picture is at worldImagePath. */
export type WorldCard = {
  name: string;
  author: string | null;
  description: string | null;
  image: boolean;
};

export const worldCardPath = (worldId: string) =>
  `/api/world/${encodeURIComponent(worldId)}/`;
export const worldImagePath = (worldId: string) =>
  `/api/world/${encodeURIComponent(worldId)}/image/`;

/** How long a picture is kept in the data centre (seconds). */
export const WORLD_IMAGE_TTL = 7 * 24 * 60 * 60;
/** What the browser may keep, of both (seconds). */
const BROWSER_TTL = 60 * 60;
const CACHE_CONTROL = `private, max-age=${BROWSER_TTL}`;

export interface WorldContext {
  cache: PreviewCache;
  fetch: typeof fetch;
  waitUntil: (promise: Promise<unknown>) => void;
  /** Where the world pages are: https://vrchat.com (tests: a fake). */
  origin: string;
}

/** A cache that keeps nothing (vite dev, Vitest without one). */
export const NO_CACHE: PreviewCache = {
  match: async () => undefined,
  put: async () => {},
};

const json = (status: number, body: unknown, cacheControl: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });

const preview = (
  worldId: string,
  ctx: WorldContext,
): Promise<WorldPreview | null> =>
  worldPreview(worldId, {
    cache: ctx.cache,
    fetch: ctx.fetch,
    waitUntil: ctx.waitUntil,
    origin: ctx.origin,
  });

/** GET /api/world/<id>: 200 WorldCard, 404 no such world (or no page). */
export const handleWorldCard = async (
  worldId: string,
  ctx: WorldContext,
): Promise<Response> => {
  if (!WORLD_ID_RE.test(worldId)) {
    return json(400, { error: "invalid world id" }, "no-store");
  }
  const got = await preview(worldId, ctx);
  if (!got) return json(404, { error: "not found" }, "private, max-age=60");
  return json(
    200,
    {
      name: got.name,
      author: got.author,
      description: got.description,
      image: got.image !== null,
    } satisfies WorldCard,
    CACHE_CONTROL,
  );
};

/** Not a real host: these entries never answer a public URL. */
const imageKey = (imageUrl: string) =>
  `https://gallery-admin/world-image/${encodeURIComponent(imageUrl)}`;

/** GET /api/world/<id>/image: the world's picture as VRChat serves it. */
export const handleWorldImage = async (
  worldId: string,
  ctx: WorldContext,
): Promise<Response> => {
  const text = (status: number, body: string) =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  if (!WORLD_ID_RE.test(worldId)) return text(400, "invalid world id");
  const got = await preview(worldId, ctx);
  if (!got?.image) return text(404, "Not Found");

  const key = imageKey(got.image);
  const hit = await ctx.cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("Cache-Control", CACHE_CONTROL);
    return res;
  }
  const picture = await fetchPicture(got.image, ctx.fetch);
  if (typeof picture === "string") {
    console.error(`world image ${worldId}: ${picture}`);
    return text(502, "Bad Gateway");
  }
  const headers = {
    "Content-Type": picture.type,
    "X-Content-Type-Options": "nosniff",
  };
  ctx.waitUntil(
    ctx.cache.put(
      key,
      new Response(picture.bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          ...headers,
          "Cache-Control": `public, s-maxage=${WORLD_IMAGE_TTL}`,
        },
      }),
    ),
  );
  return new Response(picture.bytes as Uint8Array<ArrayBuffer>, {
    headers: { ...headers, "Cache-Control": CACHE_CONTROL },
  });
};

/** A world card from /api/world/<id>, or null when it is not one. */
export const parseWorldCard = (value: unknown): WorldCard | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const str = (s: unknown) =>
    typeof s === "string" && s.trim() !== "" ? s : null;
  const name = str(v.name);
  if (!name) return null;
  return {
    name,
    author: str(v.author),
    description: str(v.description),
    image: v.image === true,
  };
};
