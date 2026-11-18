/**
 * Where the last-good snapshot (snapshot.ts) is kept, and when it is
 * rebuilt.
 *
 * With the `LAST_GOOD` KV namespace bound (production) it is one KV value
 * under SNAPSHOT_KEY, with no expiry, its content version and hash in the
 * KV metadata. The admin deletes it when a change hides something
 * (admin/src/lib/last-good.ts), so a D1 outage cannot bring that back.
 * Without the binding (local tests, or before the namespace exists) it is
 * kept in each data centre's Cache API for up to CACHE_TTL instead.
 *
 * KV is used sparingly, for its Free plan (1,000 writes and deletes,
 * 100,000 reads a day), so there is one writer: the Worker's cron
 * trigger, once a minute (index.ts `scheduled`). Each run:
 * 1. reads the content version, a single-row D1 read (the admin rewrites
 *    it on every change); unchanged since this isolate last looked: done;
 * 2. reads the stored snapshot's version (KV metadata; the value is not
 *    downloaded); the same: done;
 * 3. otherwise rebuilds the snapshot (one D1 batch, about a row per
 *    photo) and writes it (with the new version, so step 2 stops the next
 *    run even when the content came out the same).
 * So KV writes follow the admin's changes, at most one a minute, and an
 * unchanged period costs one tiny D1 read (and at most one KV read) a
 * minute. After a failed write the next attempt waits FAILURE_BACKOFF_MS
 * (in this isolate), so a full KV quota does not turn into a rebuild, and
 * its D1 rows read, every minute.
 *
 * Without the binding the snapshot is free to write, so request handlers
 * refresh it after answers from D1, each isolate at most once per
 * CHECK_MS (a cron run would only fill its own data centre's cache).
 *
 * A rebuild that read D1 just before an admin change can be written just
 * after the admin deleted the snapshot; the next run sees the new version
 * and replaces it. KV is eventually consistent: a deletion can take about
 * a minute to reach every data centre.
 */
import { buildSnapshot, readContentVersion } from "./query";
import {
  indexSnapshot,
  parseSnapshot,
  snapshotHash,
  type SnapshotIndex,
} from "./snapshot";

/** The KV key of the snapshot. Same in the admin. */
export const SNAPSHOT_KEY = "snapshot";

/** How often an isolate checks whether the snapshot is current. */
export const CHECK_MS = 60 * 1000;
/** How long an isolate reuses a snapshot it read while D1 is down. */
export const READ_MS = 60 * 1000;
/** Without KV: how long a data centre keeps its copy, in seconds. */
export const CACHE_TTL = 2 * 24 * 60 * 60;

/** Stored with the snapshot. */
export type SnapshotMeta = { version: string; hash: string };

export interface SnapshotStore {
  /** The stored snapshot's metadata, without reading the value. */
  meta(): Promise<SnapshotMeta | null>;
  /** The stored snapshot (JSON), or null. */
  load(): Promise<string | null>;
  save(json: string, meta: SnapshotMeta): Promise<void>;
}

/** The part of a KV namespace used here (tests pass a fake). */
export type KVLike = Pick<KVNamespace, "get" | "getWithMetadata" | "put">;

export const kvSnapshotStore = (kv: KVLike): SnapshotStore => ({
  meta: async () => {
    const { value, metadata } = await kv.getWithMetadata<SnapshotMeta>(
      SNAPSHOT_KEY,
      { type: "stream" },
    );
    await value?.cancel();
    return value ? metadata : null;
  },
  load: () => kv.get(SNAPSHOT_KEY),
  save: (json, meta) => kv.put(SNAPSHOT_KEY, json, { metadata: meta }),
});

/** The part of the Cache API used here. */
export interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/**
 * Not a real host, so the entry never answers a request for a public URL
 * (the snapshot holds bucket keys the API may leave out).
 */
const CACHE_KEY = "https://gallery-api/last-good/snapshot";

export const cacheSnapshotStore = (cache: CacheLike): SnapshotStore => {
  const key = () => new Request(CACHE_KEY, { method: "GET" });
  return {
    meta: async () => {
      const res = await cache.match(key());
      if (!res) return null;
      await res.body?.cancel();
      return {
        version: res.headers.get("X-Snapshot-Version") ?? "",
        hash: res.headers.get("X-Snapshot-Hash") ?? "",
      };
    },
    load: async () => (await cache.match(key()))?.text() ?? null,
    save: (json, meta) =>
      cache.put(
        key(),
        new Response(json, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, s-maxage=${CACHE_TTL}`,
            "X-Snapshot-Version": meta.version,
            "X-Snapshot-Hash": meta.hash,
          },
        }),
      ),
  };
};

/** After a failed refresh, how long before the next attempt. */
export const FAILURE_BACKOFF_MS = 15 * 60 * 1000;

/** What an isolate remembers. Lost with the isolate, which costs a read. */
export type Memo = {
  checkedAt: number | null;
  /** The content version the stored snapshot is known to match. */
  version: string | null;
  /** No refresh before this time (after a failure). */
  retryAt: number;
  read: { at: number; index: SnapshotIndex } | null;
};

export const createMemo = (): Memo => ({
  checkedAt: null,
  version: null,
  retryAt: 0,
  read: null,
});

const isolateMemo = createMemo();

export type LastGood = {
  /**
   * Bring the snapshot up to date if the content version moved. With
   * `throttle` (request handlers), at most once per CHECK_MS.
   */
  refresh(db: D1Database, opts?: { throttle?: boolean }): Promise<void>;
  /** While D1 fails: the snapshot's lookups, or null when there is none. */
  index(): Promise<SnapshotIndex | null>;
};

export const lastGood = (
  store: SnapshotStore,
  memo: Memo = isolateMemo,
  now: () => number = Date.now,
): LastGood => ({
  refresh: async (db, { throttle = false } = {}) => {
    if (now() < memo.retryAt) return;
    if (
      throttle &&
      memo.checkedAt !== null &&
      now() - memo.checkedAt < CHECK_MS
    ) {
      return;
    }
    memo.checkedAt = now();
    try {
      const version = await readContentVersion(db);
      if (memo.version === version) return;
      const meta = await store.meta();
      if (meta?.version === version) {
        memo.version = version;
        return;
      }
      const built = await buildSnapshot(db);
      const json = JSON.stringify(built.snapshot);
      // Written even when the hash is the same (a private photo edited):
      // the new version in the metadata stops the next run at step 2
      // instead of rebuilding again. One write per version change.
      await store.save(json, {
        version: built.version,
        hash: await snapshotHash(json),
      });
      memo.version = built.version;
    } catch (err) {
      console.error("last-good: refreshing the snapshot failed:", err);
      memo.retryAt = now() + FAILURE_BACKOFF_MS;
    }
  },
  index: async () => {
    if (memo.read && now() - memo.read.at < READ_MS) return memo.read.index;
    try {
      const raw = await store.load();
      const snapshot = raw === null ? null : parseSnapshot(raw);
      if (!snapshot) return null;
      const index = indexSnapshot(snapshot);
      memo.read = { at: now(), index };
      return index;
    } catch (err) {
      console.error("last-good: reading the snapshot failed:", err);
      return null;
    }
  },
});
