/**
 * Where last-good copies (last-good.ts) are kept.
 *
 * With the `LAST_GOOD` KV namespace bound (production), a positive answer
 * (HTTP 200, a non-null RPC result) is kept in Workers KV: one copy for
 * the whole world, which the admin deletes when it changes what the copy
 * shows (admin/src/lib/last-good.ts). Negative answers (404, null) stay
 * in each data centre's Cache API: they cannot expose anything, and
 * keeping them out of KV keeps scanners of random ids from spending its
 * writes.
 *
 * KV is used sparingly, for its Free plan (1,000 writes and deletes,
 * 100,000 reads a day):
 * - A copy is written only when the answer changed: its hash is kept in
 *   the KV metadata and, per isolate, in a small memo, so a page view
 *   whose answer is unchanged writes nothing (and, once memoised, reads
 *   nothing).
 * - Copies expire after LAST_GOOD_TTL; an unchanged one is written again
 *   on the first answer after that.
 * - A negative answer deletes a positive copy of the same key, if any, so
 *   the copy corrects itself as soon as D1 answers again, even if the
 *   admin's deletion was missed.
 *
 * Keys are `<generation>:<name>` (names: last-good.ts). The admin bumps
 * the generation (the `generation` key) when too much changed at once to
 * delete key by key, e.g. the site-wide metadata defaults; copies of an
 * older generation are then never read again and expire. KV is
 * eventually consistent: a deletion can take about a minute to reach
 * every data centre, a new generation up to two (KV's edge cache plus the
 * memo below). A save that read D1 just before an admin change can also
 * land just after its deletion; such a copy lasts only until D1 next
 * answers for the key (it is then rewritten or, for a 404, deleted).
 *
 * Without the binding (local tests, or before the namespace exists) every
 * copy stays in the Cache API, as before KV.
 */

/** How long a last-good copy is kept at most, in seconds: two days. */
export const LAST_GOOD_TTL = 2 * 24 * 60 * 60;

/** A kept answer: HTTP status (200 or 404) and JSON body. */
export type Copy = { status: number; body: string };

export interface LastGoodStore {
  /** The copy kept under `name`, or null. */
  load(name: string): Promise<Copy | null>;
  /** Keep `copy` under `name`. Never rejects (failures are logged). */
  save(name: string, copy: Copy): Promise<void>;
}

/** The part of the Cache API used here. */
export interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/** The part of a KV namespace used here. */
export interface KVLike {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  getWithMetadata<M>(
    key: string,
  ): Promise<{ value: string | null; metadata: M | null }>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * The cache key of a copy in the Cache API. The host is not a real one,
 * so these entries never collide with (or answer) a request for a public
 * URL; the RPC copies hold bucket paths that the HTTP API may leave out.
 */
export const cacheKey = (name: string): Request =>
  new Request(`https://gallery-api/last-good/v2/${encodeURIComponent(name)}`, {
    method: "GET",
  });

/** Every copy in the Cache API of the data centre. */
export const cacheStore = (cache: CacheLike): LastGoodStore => ({
  load: async (name) => {
    const res = await cache.match(cacheKey(name)).catch(() => undefined);
    return res ? { status: res.status, body: await res.text() } : null;
  },
  save: async (name, copy) => {
    try {
      await cache.put(
        cacheKey(name),
        new Response(copy.body, {
          status: copy.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, s-maxage=${LAST_GOOD_TTL}`,
          },
        }),
      );
    } catch (err) {
      console.error(`last-good: cache put ${name} failed:`, err);
    }
  },
});

/** The KV key holding the current generation. Same in the admin. */
export const GENERATION_KEY = "generation";

/** The KV key of a copy. Same format in the admin (last-good.ts). */
export const kvKey = (generation: string, name: string): string =>
  `${generation}:${name}`;

/** Stored with each KV copy: its status and hash. */
type Meta = { s: number; h: string };

/** How long the per-isolate memo trusts what it saw in KV. */
const MEMO_MS = 5 * 60 * 1000;
/** How long the generation is reused before KV is asked again. */
const GENERATION_MS = 60 * 1000;
/** Edge-cache time of the generation read, in seconds (KV's minimum). */
const GENERATION_CACHE_TTL = 60;
const MEMO_MAX = 2000;

/**
 * What an isolate knows about KV: each key's hash (null: no copy), and the
 * generation. Lost with the isolate, which only costs a read.
 */
export type Memo = {
  keys: Map<string, { hash: string | null; until: number }>;
  generation: { value: string; until: number } | null;
};

export const createMemo = (): Memo => ({ keys: new Map(), generation: null });

/** Shared by the requests one isolate serves. */
const isolateMemo = createMemo();

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A short hash of a copy, to tell whether it changed. */
export const copyHash = async (copy: Copy): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${copy.status}\n${copy.body}`),
    ),
  ).slice(0, 32);

/**
 * Positive copies in KV, negative ones in `fallback` (the Cache API).
 * `now` and `memo` are injectable for tests.
 */
export const kvStore = (
  kv: KVLike,
  fallback: LastGoodStore,
  memo: Memo = isolateMemo,
  now: () => number = Date.now,
): LastGoodStore => {
  const generation = async (): Promise<string> => {
    const g = memo.generation;
    if (g && g.until > now()) return g.value;
    const value =
      (await kv.get(GENERATION_KEY, { cacheTtl: GENERATION_CACHE_TTL })) ?? "0";
    memo.generation = { value, until: now() + GENERATION_MS };
    return value;
  };
  const remember = (key: string, hash: string | null) => {
    if (memo.keys.size >= MEMO_MAX) memo.keys.clear();
    memo.keys.set(key, { hash, until: now() + MEMO_MS });
  };
  const known = (key: string) => {
    const m = memo.keys.get(key);
    return m && m.until > now() ? m : undefined;
  };

  return {
    load: async (name) => {
      try {
        const key = kvKey(await generation(), name);
        const { value, metadata } = await kv.getWithMetadata<Meta>(key);
        if (value !== null) {
          return { status: metadata?.s ?? 200, body: value };
        }
      } catch (err) {
        console.error(`last-good: KV read ${name} failed:`, err);
      }
      // Only negative copies are kept there now. A positive one (from
      // before KV was bound) could predate a change the admin deleted.
      const copy = await fallback.load(name);
      return copy && copy.status !== 200 ? copy : null;
    },
    save: async (name, copy) => {
      try {
        const key = kvKey(await generation(), name);
        if (copy.status !== 200) {
          await fallback.save(name, copy);
          if (known(key)?.hash === null) return;
          const { value } = await kv.getWithMetadata<Meta>(key);
          if (value !== null) await kv.delete(key);
          remember(key, null);
          return;
        }
        const hash = await copyHash(copy);
        if (known(key)?.hash === hash) return;
        const { metadata } = await kv.getWithMetadata<Meta>(key);
        if (metadata?.h !== hash) {
          await kv.put(key, copy.body, {
            expirationTtl: LAST_GOOD_TTL,
            metadata: { s: copy.status, h: hash } satisfies Meta,
          });
        }
        remember(key, hash);
      } catch (err) {
        console.error(`last-good: KV save ${name} failed:`, err);
      }
    },
  };
};
