import { describe, expect, it } from "vitest";
import {
  handleGet,
  LAST_GOOD_TTL,
  lastGoodName,
  withLastGood,
  type Context,
  type Respond,
} from "./last-good";
import {
  cacheKey,
  cacheStore,
  createMemo,
  GENERATION_KEY,
  kvStore,
  type CacheLike,
  type KVLike,
} from "./last-good-store";
import { getMedia, getPhotoForImage, listPublicMedia } from "./query";
import { jsonResponse } from "./route";
import { d1, migratedDb } from "./sqlite-d1.test-helper";

/** The message D1 fails every query with past the Free plan's daily limit. */
const D1_LIMIT_ERROR =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Please upgrade to a paid plan or wait for the limit to reset at 00:00 UTC.";

/** A D1 that can be switched to failing every query, as on that limit. */
const flakyDb = () => {
  const raw = migratedDb();
  raw.exec(`
    INSERT INTO media (id, public_id, file, platform, timestamp, tags, visibility, metadata_visibility) VALUES
      (1, 'aaaaaaaaa2', '/p1.png', 'Real', '2023-12-01T00:00:00Z', '[]', 'public', '{"file_name":"path"}'),
      (2, 'aaaaaaaaa3', '/u.png',  'Real', '2023-12-02T00:00:00Z', '[]', 'unlisted', '{}');
  `);
  const inner = d1(raw);
  const state = { down: false };
  const db = {
    prepare: (sql: string) => inner.prepare(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      if (state.down) throw new Error(D1_LIMIT_ERROR);
      return inner.batch(stmts);
    },
  } as unknown as D1Database;
  return { db, raw, state };
};

/** caches.default stand-in: by URL. */
const memoryCache = () => {
  const entries = new Map<string, Response>();
  const cache: CacheLike = {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, res) => {
      entries.set(key.url, res);
    },
  };
  return { cache, entries };
};

/** A KV namespace in memory, counting the operations that cost. */
const memoryKV = () => {
  const entries = new Map<
    string,
    { value: string; metadata: unknown; ttl?: number }
  >();
  const count = { reads: 0, puts: 0, deletes: 0 };
  const kv: KVLike = {
    get: async (key) => {
      count.reads++;
      return entries.get(key)?.value ?? null;
    },
    getWithMetadata: async <M>(key: string) => {
      count.reads++;
      const e = entries.get(key);
      return {
        value: e?.value ?? null,
        metadata: (e?.metadata ?? null) as M | null,
      };
    },
    put: async (key, value, options) => {
      count.puts++;
      entries.set(key, {
        value,
        metadata: options?.metadata ?? null,
        ttl: options?.expirationTtl,
      });
    },
    delete: async (key) => {
      count.deletes++;
      entries.delete(key);
    },
  };
  return { kv, entries, count };
};

const setup = (opts: { kv?: boolean } = {}) => {
  const { db, raw, state } = flakyDb();
  const { cache, entries } = memoryCache();
  const kv = memoryKV();
  const clock = { now: 0 };
  const memo = createMemo();
  const store = opts.kv
    ? kvStore(kv.kv, cacheStore(cache), memo, () => clock.now)
    : cacheStore(cache);
  const pending: Promise<unknown>[] = [];
  const ctx: Context = {
    cache,
    store,
    waitUntil: (p) => void pending.push(p),
  };
  const respond: Respond = async (route) => {
    if (route.kind === "media-list") {
      return jsonResponse(200, await listPublicMedia(db));
    }
    if (route.kind === "media") {
      const item = await getMedia(db, route.id);
      return item
        ? jsonResponse(200, item)
        : jsonResponse(404, { error: "not found" });
    }
    throw new Error("not used here");
  };
  const settle = async () => {
    while (pending.length > 0) await Promise.all(pending.splice(0));
  };
  const get = async (path: string, host = "https://gallery.sksat.net") => {
    const res = await handleGet(new Request(host + path), respond, ctx);
    await settle();
    return res;
  };
  /** Forget the minute-long edge cache, as when it expires. */
  const expireEdge = () => {
    for (const url of entries.keys()) {
      if (!url.includes("/last-good/")) entries.delete(url);
    }
  };
  return {
    db,
    raw,
    state,
    entries,
    kv,
    clock,
    memo,
    ctx,
    settle,
    get,
    expireEdge,
  };
};

type Setup = ReturnType<typeof setup>;

describe("handleGet (Cache API, no KV binding)", () => {
  it("keeps a two-day last-good copy of a successful answer", async () => {
    const t = setup();
    const res = await t.get("/api/media");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBeNull();
    const copy = t.entries.get(cacheKey("http:/api/media").url);
    expect(copy?.status).toBe(200);
    expect(copy?.headers.get("Cache-Control")).toBe(
      `public, s-maxage=${LAST_GOOD_TTL}`,
    );
    expect(await copy?.clone().json()).toEqual(await res.json());
  });

  it("serves the last-good copy, marked stale, while D1 fails", async () => {
    const t = setup();
    const fresh = await (await t.get("/api/media")).json();
    t.state.down = true;
    t.expireEdge();

    const res = await t.get("/api/media");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=10, s-maxage=60",
    );
    expect(res.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await res.json()).toEqual(fresh);
  });

  it("shares copies between the public route and the service binding", async () => {
    const t = setup();
    await t.get("/api/media/aaaaaaaaa2/");
    t.state.down = true;
    const res = await t.get("/api/media/aaaaaaaaa2", "https://gallery-api");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    expect(await res.json()).toMatchObject({ id: "aaaaaaaaa2" });
  });

  it("keeps 404s too", async () => {
    const t = setup();
    expect((await t.get("/api/media/aaaaaaaaa9")).status).toBe(404);
    t.state.down = true;
    t.expireEdge();
    const res = await t.get("/api/media/aaaaaaaaa9");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
  });

  it("answers 503 with Retry-After when D1 fails and there is no copy", async () => {
    const t = setup();
    t.state.down = true;
    const res = await t.get("/api/media");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Nothing cached, so the next request tries D1 again.
    expect(t.entries.size).toBe(0);
  });

  it("answers HEAD from the copy without a body", async () => {
    const t = setup();
    await t.get("/api/media");
    t.state.down = true;
    t.expireEdge();
    const res = await handleGet(
      new Request("https://gallery.sksat.net/api/media", { method: "HEAD" }),
      async () => {
        throw new Error(D1_LIMIT_ERROR);
      },
      t.ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    expect(res.body).toBeNull();
  });
});

describe("handleGet with KV", () => {
  /** The KV key of a copy in generation 0. */
  const key = (name: string) => `0:${name}`;

  it("keeps a successful answer in KV for two days, with its hash", async () => {
    const t = setup({ kv: true });
    const res = await t.get("/api/media/aaaaaaaaa2");
    const e = t.kv.entries.get(key("http:/api/media/aaaaaaaaa2"));
    expect(e?.ttl).toBe(LAST_GOOD_TTL);
    expect(e?.metadata).toMatchObject({ s: 200, h: expect.any(String) });
    expect(JSON.parse(e!.value)).toEqual(await res.json());
    // Not in the Cache API.
    expect(t.entries.has(cacheKey("http:/api/media/aaaaaaaaa2").url)).toBe(
      false,
    );
  });

  it("writes nothing when the answer has not changed", async () => {
    const t = setup({ kv: true });
    await t.get("/api/media");
    expect(t.kv.count.puts).toBe(1);
    // Page views after the edge cache expired: same answer.
    for (let i = 0; i < 5; i++) {
      t.expireEdge();
      await t.get("/api/media");
    }
    expect(t.kv.count.puts).toBe(1);
    const reads = t.kv.count.reads;
    // A new isolate (empty memo) reads the hash once, and still no write.
    t.memo.keys.clear();
    t.memo.generation = null;
    t.expireEdge();
    await t.get("/api/media");
    expect(t.kv.count.puts).toBe(1);
    expect(t.kv.count.reads).toBe(reads + 2); // generation + the copy
  });

  it("writes again when the answer changed", async () => {
    const t = setup({ kv: true });
    await t.get("/api/media");
    t.raw.exec("UPDATE media SET tags = '[\"x\"]' WHERE id = 1");
    t.raw.exec("INSERT INTO tag (name, public) VALUES ('x', 1)");
    t.expireEdge();
    await t.get("/api/media");
    expect(t.kv.count.puts).toBe(2);
    expect(t.kv.entries.get(key("http:/api/media"))?.value).toContain('"x"');
  });

  it("serves the KV copy, marked stale, while D1 fails", async () => {
    const t = setup({ kv: true });
    const fresh = await (await t.get("/api/media/aaaaaaaaa2")).json();
    t.state.down = true;
    t.expireEdge();
    const res = await t.get("/api/media/aaaaaaaaa2");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    expect(await res.json()).toEqual(fresh);
  });

  it("answers 503 once the admin deleted the copy", async () => {
    const t = setup({ kv: true });
    await t.get("/api/media/aaaaaaaaa2");
    // The admin made the photo private and deleted its copies.
    await t.kv.kv.delete(key("http:/api/media/aaaaaaaaa2"));
    t.state.down = true;
    t.expireEdge();
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(503);
  });

  it("reads only the current generation's copies", async () => {
    const t = setup({ kv: true });
    await t.get("/api/media");
    await t.kv.kv.put(GENERATION_KEY, "1");
    t.clock.now += 61_000; // the memoised generation expires
    t.state.down = true;
    t.expireEdge();
    expect((await t.get("/api/media")).status).toBe(503);
    t.state.down = false;
    t.expireEdge();
    await t.get("/api/media");
    expect(t.kv.entries.has("1:http:/api/media")).toBe(true);
  });

  it("keeps 404s in the Cache API, not in KV", async () => {
    const t = setup({ kv: true });
    expect((await t.get("/api/media/aaaaaaaaa9")).status).toBe(404);
    expect(t.kv.count.puts).toBe(0);
    t.state.down = true;
    t.expireEdge();
    const res = await t.get("/api/media/aaaaaaaaa9");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
  });

  it("deletes the KV copy when D1 answers 404 for it (a missed deletion)", async () => {
    const t = setup({ kv: true });
    await t.get("/api/media/aaaaaaaaa2");
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.clock.now += 6 * 60_000; // past the memo
    t.expireEdge();
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
    expect(t.kv.entries.has(key("http:/api/media/aaaaaaaaa2"))).toBe(false);
    t.state.down = true;
    t.expireEdge();
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
  });

  it("ignores positive Cache API copies from before KV", async () => {
    const t = setup({ kv: true });
    await cacheStore(t.ctx.cache).save("http:/api/media", {
      status: 200,
      body: "[]",
    });
    t.state.down = true;
    expect((await t.get("/api/media")).status).toBe(503);
  });

  it("serves nothing (503) when KV itself fails", async () => {
    const t = setup({ kv: true });
    await t.get("/api/media");
    t.kv.kv.getWithMetadata = async () => {
      throw new Error("KV down");
    };
    t.state.down = true;
    t.expireEdge();
    expect((await t.get("/api/media")).status).toBe(503);
  });
});

describe("withLastGood", () => {
  const photo = (t: Setup, id: string) =>
    withLastGood(
      lastGoodName.photo(id),
      () => getPhotoForImage(t.db, id),
      t.ctx,
    ).finally(t.settle);

  for (const kv of [false, true]) {
    describe(kv ? "with KV" : "Cache API", () => {
      it("returns the result and keeps a copy", async () => {
        const t = setup({ kv });
        const fresh = await photo(t, "aaaaaaaaa3");
        expect(fresh?.file).toBe("/u.png");
        if (kv) {
          expect(t.kv.entries.has("0:rpc:photo:aaaaaaaaa3")).toBe(true);
        } else {
          expect(
            t.entries.get(cacheKey("rpc:photo:aaaaaaaaa3").url),
          ).toBeDefined();
        }
      });

      it("returns the copy while D1 fails", async () => {
        const t = setup({ kv });
        const fresh = await photo(t, "aaaaaaaaa3");
        t.state.down = true;
        expect(await photo(t, "aaaaaaaaa3")).toEqual(fresh);
      });

      it("keeps null results too", async () => {
        const t = setup({ kv });
        expect(await photo(t, "aaaaaaaaa9")).toBeNull();
        t.state.down = true;
        expect(await photo(t, "aaaaaaaaa9")).toBeNull();
        expect(t.kv.count.puts).toBe(0);
      });

      it("rethrows the D1 error when there is no copy", async () => {
        const t = setup({ kv });
        t.state.down = true;
        await expect(photo(t, "aaaaaaaaa3")).rejects.toThrow(D1_LIMIT_ERROR);
      });
    });
  }

  it("rethrows once the admin deleted the KV copy", async () => {
    const t = setup({ kv: true });
    await photo(t, "aaaaaaaaa3");
    await t.kv.kv.delete("0:rpc:photo:aaaaaaaaa3");
    t.state.down = true;
    await expect(photo(t, "aaaaaaaaa3")).rejects.toThrow(D1_LIMIT_ERROR);
  });

  it("deletes the KV copy when the RPC now returns null", async () => {
    const t = setup({ kv: true });
    await photo(t, "aaaaaaaaa3");
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 2");
    t.clock.now += 6 * 60_000; // past the memo
    expect(await photo(t, "aaaaaaaaa3")).toBeNull();
    expect(t.kv.entries.has("0:rpc:photo:aaaaaaaaa3")).toBe(false);
    t.state.down = true;
    expect(await photo(t, "aaaaaaaaa3")).toBeNull();
  });

  it("names copies as the admin deletes them", () => {
    // admin/src/lib/last-good.spec.ts pins the same strings.
    expect(lastGoodName.http("/api/media/")).toBe("http:/api/media");
    expect(lastGoodName.http("/api/camera/x")).toBe("http:/api/camera/x");
    expect(lastGoodName.photo("aaaaaaaaa2")).toBe("rpc:photo:aaaaaaaaa2");
    expect(lastGoodName.pathAccess("/a/b.png")).toBe(
      "rpc:pathAccess:/a/b.png",
    );
  });
});
