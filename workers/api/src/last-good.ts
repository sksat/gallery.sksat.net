/**
 * Serving the last-good snapshot (snapshot.ts, kept by
 * last-good-store.ts) when D1 fails.
 *
 * Every answer from D1 is served as is, and afterwards (waitUntil) the
 * snapshot is brought up to date if it is due. When D1 (or anything in
 * the query layer) throws, the answer comes from the snapshot instead,
 * marked stale; only when there is none does the HTTP API answer 503
 * (the RPCs rethrow). The snapshot only ever holds what the API would
 * answer, and the admin deletes it when it hides something, so a D1
 * outage does not bring back what was hidden.
 */
import { parseRoute, CACHE_CONTROL, jsonResponse, type Route } from "./route";
import type { CacheLike, LastGood } from "./last-good-store";
import type { SnapshotIndex } from "./snapshot";

/** Marks a response served from the snapshot. */
export const STALE_HEADER = "X-Stale";

/** Seconds a client is asked to wait after a 503. */
export const RETRY_AFTER = 60;

const NOT_FOUND = { error: "not found" };

export interface Context {
  /** The minute-long edge cache of HTTP answers. */
  cache: CacheLike;
  lastGood: LastGood;
  /** Brings the snapshot up to date if due (lastGood.refresh with D1). */
  refresh: () => Promise<void>;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** The answer for a route, from D1. Throws if D1 fails. */
export type Respond = (route: Route) => Promise<Response>;

/**
 * GET/HEAD on the public API: the edge cache (a minute), else D1, else the
 * snapshot, else 503.
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

  let response: Response;
  try {
    response = await respond(route);
  } catch (err) {
    console.error(`GET ${url.pathname} failed:`, err);
    const index = await ctx.lastGood.index();
    if (!index) {
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
    const { status, body } = index.answer(route);
    response = jsonResponse(status, body);
    response.headers.set(STALE_HEADER, "d1-error");
    // Cached for a minute like a fresh answer, so D1 is not retried on
    // every request while it is down.
    ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()));
    return head ? withoutBody(response) : response;
  }
  ctx.waitUntil(ctx.refresh());
  ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()));
  return head ? withoutBody(response) : response;
};

/**
 * An RPC result from `load`; when it throws, `fromSnapshot` of the
 * snapshot instead, or the error if there is none.
 */
export const withLastGood = async <T>(
  name: string,
  load: () => Promise<T>,
  fromSnapshot: (index: SnapshotIndex) => T,
  ctx: Context,
): Promise<T> => {
  let value: T;
  try {
    value = await load();
  } catch (err) {
    const index = await ctx.lastGood.index();
    if (!index) throw err;
    console.error(`${name} failed, serving the snapshot:`, err);
    return fromSnapshot(index);
  }
  ctx.waitUntil(ctx.refresh());
  return value;
};

const withoutBody = (res: Response): Response =>
  new Response(null, { status: res.status, headers: res.headers });
