/**
 * Last-known-good copies, so the public site survives a D1 outage (for
 * instance the Free plan's daily row-read limit, which fails every query
 * until 00:00 UTC).
 *
 * Every answer the API gives from D1 (HTTP 200/404, RPC results) is also
 * kept in the Cache API under a separate key for up to two days. When D1
 * (or anything in the query layer) throws, the kept copy for the same key
 * is served instead, marked stale; only when there is none does the HTTP
 * API answer 503 (the RPCs rethrow). The copy is only ever what was
 * answered for that same key before, so nothing that was never public is
 * exposed.
 *
 * Copies live in each data centre's cache (caches.default) and are
 * replaced only where the key is answered again. So while D1 is down, a
 * data centre may serve a copy from before a visibility change (a photo
 * made private, a file renamed) made in the last two days, until D1 is
 * back. The TTL is kept short for that reason; it still outlasts a daily
 * limit, which resets at 00:00 UTC. Copies are best-effort: rarely read
 * entries may be evicted sooner. Puts go through waitUntil and add no D1
 * reads.
 */
import { parseRoute, CACHE_CONTROL, jsonResponse, type Route } from "./route";

/** The part of the Cache API used here. */
export interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/** How long a last-good copy is kept at most: two days. */
export const LAST_GOOD_TTL = 2 * 24 * 60 * 60;

/** Marks a response served from a last-good copy. */
export const STALE_HEADER = "X-Stale";

/** Seconds a client is asked to wait after a 503. */
export const RETRY_AFTER = 60;

/**
 * The cache key of a last-good copy. The host is not a real one, so these
 * entries never collide with (or answer) a request for a public URL; the
 * RPC copies hold bucket paths that the HTTP API may leave out.
 */
export const lastGoodKey = (name: string): Request =>
  new Request(`https://gallery-api/last-good${name}`, { method: "GET" });

const NOT_FOUND = { error: "not found" };

export interface Context {
  cache: CacheLike;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** The answer for a route, from D1. Throws if D1 fails. */
export type Respond = (route: Route) => Promise<Response>;

/** Keep `response` as the last-good copy for `key` (in the background). */
const keep = (ctx: Context, key: Request, response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, s-maxage=${LAST_GOOD_TTL}`);
  ctx.waitUntil(
    ctx.cache.put(
      key,
      new Response(response.clone().body, {
        status: response.status,
        headers,
      }),
    ),
  );
};

/**
 * GET/HEAD on the public API: the edge cache (a minute), else D1, else the
 * last-good copy, else 503.
 */
export const handleGet = async (
  request: Request,
  respond: Respond,
  ctx: Context,
): Promise<Response> => {
  const url = new URL(request.url);
  const route = parseRoute(url.pathname);
  if (!route) return jsonResponse(404, NOT_FOUND);
  const head = request.method === "HEAD";

  // Cache by path only: the API takes no query parameters, so this also
  // keeps cache-busting query strings from reaching D1.
  const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
  const hit = await ctx.cache.match(cacheKey);
  if (hit) return head ? withoutBody(hit) : hit;

  // Shared by the public route and the service binding (whose host is a
  // placeholder), and by paths with or without a trailing slash.
  const lastGood = lastGoodKey(url.pathname.replace(/\/$/, ""));
  let response: Response;
  try {
    response = await respond(route);
  } catch (err) {
    console.error(`GET ${url.pathname} failed:`, err);
    const copy = await ctx.cache.match(lastGood).catch(() => undefined);
    if (!copy) {
      return new Response(JSON.stringify({ error: "service unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(RETRY_AFTER),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const headers = new Headers(copy.headers);
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set(STALE_HEADER, "d1-error");
    response = new Response(copy.body, { status: copy.status, headers });
    // Cached for a minute like a fresh answer, so D1 is not retried on
    // every request while it is down.
    ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()));
    return head ? withoutBody(response) : response;
  }
  if (response.status === 200 || response.status === 404) {
    keep(ctx, lastGood, response);
  }
  ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()));
  return head ? withoutBody(response) : response;
};

/**
 * An RPC result from `load`, kept as the last-good copy under `name`
 * (method and arguments); when `load` throws, the copy instead, or the
 * error if there is none.
 */
export const withLastGood = async <T>(
  name: string,
  load: () => Promise<T>,
  ctx: Context,
): Promise<T> => {
  const key = lastGoodKey(name);
  let value: T;
  try {
    value = await load();
  } catch (err) {
    const copy = await ctx.cache.match(key).catch(() => undefined);
    if (!copy) throw err;
    console.error(`${name} failed, serving the last-good copy:`, err);
    return (await copy.json()) as T;
  }
  keep(ctx, key, Response.json(value ?? null));
  return value;
};

const withoutBody = (res: Response): Response =>
  new Response(null, { status: res.status, headers: res.headers });
