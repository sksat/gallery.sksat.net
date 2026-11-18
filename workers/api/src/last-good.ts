/**
 * Last-known-good copies, so the public site survives a D1 outage (for
 * instance the Free plan's daily row-read limit, which fails every query
 * until 00:00 UTC).
 *
 * Every answer the API gives from D1 (HTTP 200/404, RPC results) is also
 * kept as a copy under a name for its path or method and arguments (see
 * last-good-store.ts for where: Workers KV, which the admin can delete
 * from, or the Cache API). When D1 (or anything in the query layer)
 * throws, the kept copy for the same name is served instead, marked
 * stale; only when there is none does the HTTP API answer 503 (the RPCs
 * rethrow). The copy is only ever what was answered for that same name
 * before, and the admin deletes the copies a change of its affects (a
 * photo made private, moved, its metadata cut down), so a D1 outage does
 * not bring back what was hidden.
 *
 * Copies are kept for up to LAST_GOOD_TTL, which outlasts a daily limit
 * (reset at 00:00 UTC). They are best-effort: a failed save is only
 * logged. Saves go through waitUntil and add no D1 reads.
 */
import { parseRoute, CACHE_CONTROL, jsonResponse, type Route } from "./route";
import type { CacheLike, Copy, LastGoodStore } from "./last-good-store";

export { LAST_GOOD_TTL } from "./last-good-store";

/** Marks a response served from a last-good copy. */
export const STALE_HEADER = "X-Stale";

/** Seconds a client is asked to wait after a 503. */
export const RETRY_AFTER = 60;

/**
 * Names of the copies. The admin deletes them by these names
 * (admin/src/lib/last-good.ts): keep the two in step.
 */
export const lastGoodName = {
  /** An HTTP path without its trailing slash, e.g. `http:/api/media`. */
  http: (pathname: string) => `http:${pathname.replace(/\/$/, "")}`,
  photo: (publicId: string) => `rpc:photo:${publicId}`,
  pathAccess: (path: string) => `rpc:pathAccess:${path}`,
};

const NOT_FOUND = { error: "not found" };

export interface Context {
  /** The minute-long edge cache of HTTP answers. */
  cache: CacheLike;
  /** Where the last-good copies are. */
  store: LastGoodStore;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** The answer for a route, from D1. Throws if D1 fails. */
export type Respond = (route: Route) => Promise<Response>;

/** Keep `copy` as the last-good copy for `name` (in the background). */
const keep = (ctx: Context, name: string, copy: Promise<Copy>) => {
  ctx.waitUntil(copy.then((c) => ctx.store.save(name, c)));
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
  const name = lastGoodName.http(url.pathname);
  let response: Response;
  try {
    response = await respond(route);
  } catch (err) {
    console.error(`GET ${url.pathname} failed:`, err);
    const copy = await ctx.store.load(name).catch(() => null);
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
    response = new Response(copy.body, {
      status: copy.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
        [STALE_HEADER]: "d1-error",
      },
    });
    // Cached for a minute like a fresh answer, so D1 is not retried on
    // every request while it is down.
    ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()));
    return head ? withoutBody(response) : response;
  }
  if (response.status === 200 || response.status === 404) {
    const status = response.status;
    keep(
      ctx,
      name,
      response
        .clone()
        .text()
        .then((body) => ({ status, body })),
    );
  }
  ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()));
  return head ? withoutBody(response) : response;
};

/**
 * An RPC result from `load`, kept as the last-good copy under `name`
 * (lastGoodName); when `load` throws, the copy instead, or the error if
 * there is none. A null result is kept as a negative copy (404).
 */
export const withLastGood = async <T>(
  name: string,
  load: () => Promise<T>,
  ctx: Context,
): Promise<T> => {
  let value: T;
  try {
    value = await load();
  } catch (err) {
    const copy = await ctx.store.load(name).catch(() => null);
    if (!copy) throw err;
    console.error(`${name} failed, serving the last-good copy:`, err);
    return JSON.parse(copy.body) as T;
  }
  keep(
    ctx,
    name,
    Promise.resolve({
      status: value == null ? 404 : 200,
      body: JSON.stringify(value ?? null),
    }),
  );
  return value;
};

const withoutBody = (res: Response): Response =>
  new Response(null, { status: res.status, headers: res.headers });
