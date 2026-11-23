/**
 * Answers kept per content version, so D1 is read only when something
 * changed, and the site survives a D1 outage (for instance the Free
 * plan's daily row-read limit, which fails every query until 00:00 UTC).
 *
 * The admin rewrites the `setting` row `content_version` after every
 * change to what this API answers (admin/src/lib/last-good.ts). Every
 * answer, HTTP and RPC alike, is kept in the data centre's Cache API
 * under that version (dataKey: `https://gallery-api/data/v/<rules>/
 * <version>/<name>`, for DATA_TTL), 404s and nulls included, so ids that
 * do not exist do not reach D1 again either. A request:
 * 1. learns the current version: from the isolate's memo or the data
 *    centre's VERSION_KEY entry while either is younger than VERSION_MS,
 *    else from D1 (one single-row read), which refreshes both and the
 *    LATEST_KEY pointer;
 * 2. answers from the entry for that version, or builds just that answer
 *    from D1 (the same targeted query as without the cache) and keeps it.
 *    An entry older than ENTRY_MAX_AGE_MS is built again, which bounds
 *    how long a change whose version bump was lost can go unseen.
 * So D1 sees one tiny read a minute per data centre while nothing
 * changes, and after a change each answer is built once per data centre.
 *
 * When D1 fails (the version read, or building an entry), the answer
 * comes from the entries of the newest version this data centre has seen
 * (LATEST_KEY, or the isolate's memo if newer), marked `X-Stale:
 * d1-error`; with none, HTTP answers 503 and the RPCs rethrow. Entries of
 * an older version are never served once a newer one has been seen, so in
 * a data centre that has read the version since the admin hid a photo,
 * the photo is not served again, outage or not. A data centre that had no
 * traffic between the change and the outage still has only the older
 * version to fall back on.
 */
import { readContentVersion } from "./query";
import { parseRoute, CACHE_CONTROL, jsonResponse, type Route } from "./route";

/** Marks an answer served while D1 fails. */
export const STALE_HEADER = "X-Stale";

/** Seconds a client is asked to wait after a 503. */
export const RETRY_AFTER = 60;

/** How long a content version read from D1 is trusted. */
export const VERSION_MS = 60 * 1000;
/** After a failed D1 read, how long to answer from the cache only. */
export const RETRY_MS = 30 * 1000;
/** An entry older than this is built again (while D1 answers). */
export const ENTRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How long an entry is kept (seconds), to answer from during outages. */
export const DATA_TTL = 30 * 24 * 60 * 60;

/**
 * Not a real host, so these entries never answer a request for a public
 * URL (RPC entries hold bucket keys the HTTP API may leave out).
 */
const BASE = "https://gallery-api/data";
export const VERSION_KEY = `${BASE}/version`;
export const LATEST_KEY = `${BASE}/latest`;

/**
 * Part of every entry's key. Change it when a deploy changes what an
 * answer holds for the same data (a stricter visibility rule, say), so
 * that entries built by the older code are never served again, outage or
 * not; an outage right after such a deploy answers 503 until the entries
 * are built again. 2: a photo is a camera picture only while it is public.
 */
export const ANSWER_RULES = "2";

/** The cache key of an entry. */
export const dataKey = (version: string, name: string): string =>
  `${BASE}/v/${ANSWER_RULES}/${encodeURIComponent(version)}/${name}`;

/** The part of the Cache API used here. */
export interface CacheLike {
  match(key: Request | string): Promise<Response | undefined>;
  put(key: Request | string, response: Response): Promise<void>;
}

/** An answer: HTTP status (200 or 404) and JSON body. */
export type Entry = { status: number; body: string };

/** What an isolate remembers. */
export type Memo = {
  /** The current version and when it was read from D1. */
  version: { value: string; readAt: number } | null;
  /** No D1 read before this time (after a failure). */
  retryAt: number;
  /** That failure, rethrown by the RPCs. */
  error: unknown;
};

export const createMemo = (): Memo => ({
  version: null,
  retryAt: 0,
  error: null,
});

const isolateMemo = createMemo();

export interface Context {
  cache: CacheLike;
  db: D1Database;
  waitUntil: (promise: Promise<unknown>) => void;
  memo?: Memo;
  now?: () => number;
}

const READ_AT = "X-Read-At";
const BUILT_AT = "X-Built-At";

const kept = (
  body: string,
  status: number,
  ttlSeconds: number,
  headers: Record<string, string>,
) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, s-maxage=${ttlSeconds}`,
      ...headers,
    },
  });

const readAtOf = (res: Response | undefined) =>
  Number(res?.headers.get(READ_AT) ?? NaN);

/**
 * Store a version read at `readAt` under `key`, unless what is there was
 * read later (a slower, older read must not replace a newer one).
 */
const keepVersion = async (
  ctx: Context,
  key: string,
  value: string,
  readAt: number,
  ttlSeconds: number,
) => {
  const there = await ctx.cache.match(key);
  if (there && readAtOf(there) > readAt) return;
  await ctx.cache.put(
    key,
    kept(value, 200, ttlSeconds, { [READ_AT]: String(readAt) }),
  );
};

type Version = { value: string; stale: boolean };

/** The version to answer from, or null when there is none. */
const currentVersion = async (ctx: Context): Promise<Version | null> => {
  const memo = ctx.memo ?? isolateMemo;
  const now = (ctx.now ?? Date.now)();
  if (memo.version && now - memo.version.readAt < VERSION_MS) {
    return { value: memo.version.value, stale: now < memo.retryAt };
  }
  if (now >= memo.retryAt) {
    const shared = await ctx.cache.match(VERSION_KEY);
    const sharedAt = readAtOf(shared);
    if (shared && now - sharedAt < VERSION_MS) {
      memo.version = { value: await shared.text(), readAt: sharedAt };
      return { value: memo.version.value, stale: false };
    }
    try {
      const value = await readContentVersion(ctx.db);
      memo.version = { value, readAt: now };
      ctx.waitUntil(
        Promise.all([
          keepVersion(ctx, VERSION_KEY, value, now, VERSION_MS / 1000),
          keepVersion(ctx, LATEST_KEY, value, now, DATA_TTL),
        ]),
      );
      return { value, stale: false };
    } catch (err) {
      console.error("reading the content version failed:", err);
      memo.retryAt = now + RETRY_MS;
      memo.error = err;
    }
  }
  // D1 is failing: the newest version this data centre has seen, or the
  // memo's if this isolate read a newer one.
  const latest = await ctx.cache.match(LATEST_KEY);
  if (latest && (!memo.version || readAtOf(latest) >= memo.version.readAt)) {
    return { value: await latest.text(), stale: true };
  }
  return memo.version ? { value: memo.version.value, stale: true } : null;
};

/** A kept answer; `body` is passed on as is. */
export type Got = {
  status: number;
  body: ReadableStream | string | null;
  stale: boolean;
};

/**
 * The entry `name` for the current version: kept, or built from D1 and
 * kept. Null when D1 fails and this version has no such entry.
 */
export const answer = async (
  name: string,
  build: () => Promise<Entry>,
  ctx: Context,
): Promise<Got | null> => {
  const version = await currentVersion(ctx);
  if (!version) return null;
  const memo = ctx.memo ?? isolateMemo;
  const now = (ctx.now ?? Date.now)();
  const key = dataKey(version.value, name);
  const hit = await ctx.cache.match(key);
  const canBuild = !version.stale && now >= memo.retryAt;
  if (
    hit &&
    (!canBuild || now - Number(hit.headers.get(BUILT_AT)) < ENTRY_MAX_AGE_MS)
  ) {
    return { status: hit.status, body: hit.body, stale: version.stale };
  }
  if (!canBuild) return null;
  let entry: Entry;
  try {
    entry = await build();
  } catch (err) {
    console.error(`building ${name} failed:`, err);
    memo.retryAt = now + RETRY_MS;
    memo.error = err;
    if (hit) return { status: hit.status, body: hit.body, stale: true };
    return null;
  }
  ctx.waitUntil(
    ctx.cache.put(
      key,
      kept(entry.body, entry.status, DATA_TTL, { [BUILT_AT]: String(now) }),
    ),
  );
  return { status: entry.status, body: entry.body, stale: false };
};

/** The answer for a route, from D1. Throws if D1 fails. */
export type Respond = (route: Route) => Promise<Entry>;

export const unavailable = () =>
  new Response(JSON.stringify({ error: "service unavailable" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(RETRY_AFTER),
      "X-Content-Type-Options": "nosniff",
    },
  });

/** GET/HEAD on the public API. */
export const handleGet = async (
  request: Request,
  respond: Respond,
  ctx: Context,
): Promise<Response> => {
  const url = new URL(request.url);
  const route = parseRoute(url.pathname);
  if (!route) return jsonResponse(404, { error: "not found" });
  // By path only: the API takes no query parameters. Shared by the public
  // route and the service binding, with or without a trailing slash.
  const name = `http${url.pathname.replace(/\/$/, "")}`;
  const got = await answer(name, () => respond(route), ctx);
  if (!got) return unavailable();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  if (got.stale) headers[STALE_HEADER] = "d1-error";
  return new Response(request.method === "HEAD" ? null : got.body, {
    status: got.status,
    headers,
  });
};

/**
 * An RPC result kept like the HTTP answers under `name` (null results
 * too). Throws the D1 error when it cannot be had.
 */
export const rpcAnswer = async <T>(
  name: string,
  load: () => Promise<T | null>,
  ctx: Context,
): Promise<T | null> => {
  const got = await answer(
    name,
    async () => {
      const value = await load();
      return {
        status: value === null ? 404 : 200,
        body: JSON.stringify(value),
      };
    },
    ctx,
  );
  if (!got) {
    throw (
      (ctx.memo ?? isolateMemo).error ?? new Error(`${name}: D1 is unavailable`)
    );
  }
  return JSON.parse(await new Response(got.body).text()) as T | null;
};
