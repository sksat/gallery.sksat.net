import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { handleGet, withLastGood, type Context, type Respond } from "./last-good";
import {
  cacheSnapshotStore,
  CHECK_MS,
  createMemo,
  kvSnapshotStore,
  lastGood,
  SNAPSHOT_KEY,
  type CacheLike,
  type KVLike,
} from "./last-good-store";
import {
  buildSnapshot,
  CONTENT_VERSION_KEY,
  getCamera,
  getMedia,
  getPathAccess,
  getPhotoForImage,
  listCameras,
  listPublicMedia,
} from "./query";
import { parseRoute, jsonResponse, type Route } from "./route";
import { indexSnapshot } from "./snapshot";
import { d1, migratedDb } from "./sqlite-d1.test-helper";

/** The message D1 fails every query with past the Free plan's daily limit. */
const D1_LIMIT_ERROR =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Please upgrade to a paid plan or wait for the limit to reset at 00:00 UTC.";

const FIXTURE = `
  INSERT INTO camera (id, slug, name, manufacturer, model) VALUES
    (1, 'cam-a', 'A', 'Maker', 'A1'),
    (2, 'cam-b', 'B', NULL, NULL),
    (3, 'cam-c', 'C', NULL, NULL);
  INSERT INTO camera_image (camera_id, file, caption, position) VALUES
    (1, '/camera/cam-a/front.png', 'front', 0),
    (1, '/camera/cam-a/back.png', NULL, 1),
    (3, '/V/p.png', NULL, 0);
  INSERT INTO tag (name, public) VALUES ('pub', 1), ('secret', 0);
  INSERT INTO media (id, public_id, file, path, platform, timestamp, tags, visibility, metadata_visibility, camera_id) VALUES
    (1, 'aaaaaaaaa2', '/p1.png', '/p1.png', 'Real', '2023-12-01T00:00:00Z', '["pub","secret"]', 'public', '{"file_name":"path"}', 1),
    (2, 'aaaaaaaaa3', '/u.png', '/u.png', 'Real', '2023-12-02T00:00:00Z', '[]', 'unlisted', '{"file_name":"path"}', 2),
    (3, 'aaaaaaaaa4', '/V/p.png', '/V/p.png', 'VRChat', '2023-12-03T00:00:00Z', '[]', 'private', '{"file_name":"path"}', 3),
    (4, 'aaaaaaaaa5', '/old.png', '/moved/new.png', 'Real', NULL, '[]', 'public', '{"file_name":"path"}', NULL),
    (5, 'aaaaaaaaa6', '/hidden.png', '/hidden.png', 'Real', '2023-12-04T00:00:00Z', '[]', 'public', '{"file_name":"hidden","camera":"manufacturer"}', 1);
  INSERT INTO media (id, public_id, file, platform, visibility, trashed_at) VALUES
    (6, 'aaaaaaaaa7', '/t.png', 'Real', 'public', '2023-12-05T00:00:00Z');
  INSERT INTO media (id, public_id, file, platform, visibility, status) VALUES
    (7, 'aaaaaaaaa8', '/up.png', 'Real', 'public', 'uploading');
`;

/** A D1 that can be switched to failing every query, counting reads. */
const flakyDb = (raw: DatabaseSync) => {
  const inner = d1(raw);
  const state = { down: false, batches: 0, firsts: 0 };
  const check = () => {
    if (state.down) throw new Error(D1_LIMIT_ERROR);
  };
  const db = {
    prepare: (sql: string) => {
      const s = inner.prepare(sql);
      const wrap = (st: D1PreparedStatement): D1PreparedStatement =>
        ({
          ...st,
          bind: (...args: unknown[]) => wrap(st.bind(...args)),
          first: async () => {
            check();
            state.firsts++;
            return st.first();
          },
          all: st.all,
        }) as unknown as D1PreparedStatement;
      return wrap(s);
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      check();
      state.batches++;
      return inner.batch(stmts);
    },
  } as unknown as D1Database;
  return { db, state };
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
  const entries = new Map<string, { value: string; metadata: unknown }>();
  const count = { reads: 0, puts: 0 };
  const kv = {
    get: async (key: string) => {
      count.reads++;
      return entries.get(key)?.value ?? null;
    },
    getWithMetadata: async (key: string) => {
      count.reads++;
      const e = entries.get(key);
      return {
        value: e ? new Response(e.value).body : null,
        metadata: e?.metadata ?? null,
      };
    },
    put: async (key: string, value: string, options?: { metadata?: unknown }) => {
      count.puts++;
      entries.set(key, { value, metadata: options?.metadata ?? null });
    },
    /** What the admin does when it hides something. */
    delete: async (key: string) => {
      entries.delete(key);
    },
  };
  return { kv, entries, count };
};

/** Live answers from D1, as index.ts gives them. */
const live = (db: D1Database): Respond => async (route) => {
  switch (route.kind) {
    case "media-list":
      return jsonResponse(200, await listPublicMedia(db));
    case "media": {
      const item = await getMedia(db, route.id);
      return item
        ? jsonResponse(200, item)
        : jsonResponse(404, { error: "not found" });
    }
    case "camera-list":
      return jsonResponse(200, await listCameras(db));
    case "camera": {
      const c = await getCamera(db, route.slug);
      return c ? jsonResponse(200, c) : jsonResponse(404, { error: "not found" });
    }
  }
};

const setup = (opts: { kv?: boolean } = {}) => {
  const raw = migratedDb();
  raw.exec(FIXTURE);
  const { db, state } = flakyDb(raw);
  const { cache, entries } = memoryCache();
  const kv = memoryKV();
  const clock = { now: 1_000_000 };
  const memo = createMemo();
  const store = opts.kv
    ? kvSnapshotStore(kv.kv as unknown as KVLike)
    : cacheSnapshotStore(cache);
  const lg = lastGood(store, memo, () => clock.now);
  const pending: Promise<unknown>[] = [];
  const ctx: Context = {
    cache,
    lastGood: lg,
    // As index.ts: with KV only the cron trigger writes.
    refresh: opts.kv
      ? async () => {}
      : () => lg.refresh(db, { throttle: true }),
    waitUntil: (p) => void pending.push(p),
  };
  /** A cron run (index.ts `scheduled`). */
  const tick = () => lg.refresh(db);
  const settle = async () => {
    while (pending.length > 0) await Promise.all(pending.splice(0));
  };
  /** Forget the minute-long edge cache, as when it expires. */
  const expireEdge = () => {
    for (const url of entries.keys()) {
      if (!url.includes("/last-good/")) entries.delete(url);
    }
  };
  const get = async (path: string, method = "GET") => {
    expireEdge();
    const res = await handleGet(
      new Request(`https://gallery.sksat.net${path}`, { method }),
      live(db),
      ctx,
    );
    await settle();
    return res;
  };
  /** As the admin does after a change. */
  const bump = (v: string) =>
    raw.exec(`INSERT INTO setting (key, value) VALUES ('${CONTENT_VERSION_KEY}', '"${v}"')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  const later = (ms = CHECK_MS) => {
    clock.now += ms;
  };
  return {
    tick,
    raw,
    db,
    state,
    entries,
    kv,
    clock,
    memo,
    ctx,
    lg,
    settle,
    get,
    bump,
    later,
  };
};

type Setup = ReturnType<typeof setup>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const PATHS = [
  "/api/media",
  "/api/media/aaaaaaaaa2",
  "/api/media/aaaaaaaaa3",
  "/api/media/aaaaaaaaa4",
  "/api/media/aaaaaaaaa5",
  "/api/media/aaaaaaaaa6",
  "/api/media/aaaaaaaaa7",
  "/api/media/aaaaaaaaa8",
  "/api/media/zzzzzzzzzz",
  "/api/camera",
  "/api/camera/cam-a",
  "/api/camera/cam-b",
  "/api/camera/cam-c",
  "/api/camera/nope",
];

const IMG_PATHS = [
  "/p1.png",
  "/u.png",
  "/V/p.png",
  "/old.png",
  "/moved/new.png",
  "/hidden.png",
  "/t.png",
  "/camera/cam-a/front.png",
  "/camera/cam-a/back.png",
  "/nothing.png",
];

const IDS = PATHS.filter((p) => p.startsWith("/api/media/")).map((p) =>
  p.slice("/api/media/".length),
);

describe("the snapshot", () => {
  it("answers every endpoint and RPC exactly as D1 does", async () => {
    const t = setup();
    const index = indexSnapshot((await buildSnapshot(t.db)).snapshot);
    for (const path of PATHS) {
      const route = parseRoute(path) as Route;
      const fresh = await live(t.db)(route);
      const answer = index.answer(route);
      expect([path, answer.status]).toEqual([path, fresh.status]);
      expect(answer.body).toEqual(await fresh.json());
    }
    for (const id of IDS) {
      expect([id, index.photo(id)]).toEqual([
        id,
        await getPhotoForImage(t.db, id),
      ]);
    }
    for (const p of IMG_PATHS) {
      expect([p, index.pathAccess(p)]).toEqual([
        p,
        await getPathAccess(t.db, p),
      ]);
    }
  });

  it("never holds private, trashed or unfinished photos", async () => {
    const t = setup();
    const json = JSON.stringify((await buildSnapshot(t.db)).snapshot);
    for (const s of ["aaaaaaaaa4", "aaaaaaaaa7", "aaaaaaaaa8", "secret"]) {
      expect(json).not.toContain(s);
    }
  });

  it("stays small and quick to build with 2,000 photos", async () => {
    const raw = migratedDb();
    raw.exec(FIXTURE);
    const insert = raw.prepare(
      `INSERT INTO media (public_id, file, platform, timestamp, tags, visibility, camera_id, exif, latitude, longitude, world_id, world_name, metadata_visibility)
       VALUES (?, ?, 'VRChat', ?, '["pub","a-longer-tag-name"]', ?, 1, ?, 35.6812, 139.7671, 'wrld_0123456789abcdef0123456789abcdef', 'Some World Name', '{"file_name":"path","location":"exact","exif":"all"}')`,
    );
    const exif = JSON.stringify({
      make: "Maker",
      model: "Model X",
      lens: "Lens 24-70mm",
      focal_length_mm: 35,
      f_number: 2.8,
      exposure_time: "1/250",
      iso: 400,
    });
    const letters = "23456789abcdefghjkmnpqrstuvwxyz";
    for (let i = 0; i < 2000; i++) {
      let id = "";
      for (let n = i, k = 0; k < 10; k++, n = Math.floor(n / 31)) {
        id += letters[n % 31];
      }
      insert.run(
        id,
        `/VRChat/2026-11/VRChat_2026-11-19_12-34-56.${String(i).padStart(4, "0")}_7680x4320.png`,
        `2026-11-19T12:34:${String(i % 60).padStart(2, "0")}+09:00`,
        i % 10 === 0 ? "unlisted" : "public",
        exif,
      );
    }
    const started = performance.now();
    const { snapshot } = await buildSnapshot(d1(raw));
    const ms = performance.now() - started;
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    expect(snapshot.photos.length).toBe(2000 + 4);
    // KV values may be 25 MB; a few hundred bytes a photo.
    expect(bytes).toBeLessThan(2_500_000);
    expect(ms).toBeLessThan(2000);
    console.info(`snapshot of 2,004 photos: ${bytes} bytes, ${ms.toFixed(0)} ms`);
  });
});

describe("keeping the snapshot in KV", () => {
  it("is written by the cron run only, without expiry", async () => {
    const t = setup({ kv: true });
    // Answers from D1 never write to KV.
    for (const p of PATHS) await t.get(p);
    expect(t.kv.count.puts).toBe(0);
    await t.tick();
    expect(t.kv.count.puts).toBe(1);
    const e = t.kv.entries.get(SNAPSHOT_KEY);
    expect(e?.metadata).toMatchObject({ version: "", hash: expect.any(String) });
  });

  it("writes and rebuilds nothing while the content version is unchanged", async () => {
    const t = setup({ kv: true });
    await t.tick();
    const batches = t.state.batches;
    const firsts = t.state.firsts;
    const reads = t.kv.count.reads;
    for (let i = 0; i < 10; i++) {
      t.later();
      await t.tick();
    }
    expect(t.kv.count.puts).toBe(1);
    expect(t.state.batches).toBe(batches); // no rebuild
    expect(t.state.firsts - firsts).toBe(10); // one version row a run
    expect(t.kv.count.reads).toBe(reads); // the memo knows the version
  });

  it("a new isolate reads the stored version, not the value, and stops", async () => {
    const t = setup({ kv: true });
    await t.tick();
    const fresh = lastGood(
      kvSnapshotStore(t.kv.kv as unknown as KVLike),
      createMemo(),
    );
    const batches = t.state.batches;
    await fresh.refresh(t.db);
    expect(t.state.batches).toBe(batches);
    expect(t.kv.count.puts).toBe(1);
  });

  it("writes once per content version, even when the content came out the same", async () => {
    const t = setup({ kv: true });
    await t.tick();
    t.raw.exec("UPDATE media SET tags = '[\"other\"]' WHERE id = 3"); // private
    t.bump("v2");
    await t.tick();
    // Recorded with the new version...
    expect(t.kv.count.puts).toBe(2);
    expect(t.kv.entries.get(SNAPSHOT_KEY)?.metadata).toMatchObject({
      version: '"v2"',
    });
    // ...so later runs, and new isolates, stop at the metadata.
    const batches = t.state.batches;
    await t.tick();
    await lastGood(
      kvSnapshotStore(t.kv.kv as unknown as KVLike),
      createMemo(),
    ).refresh(t.db);
    expect(t.state.batches).toBe(batches);
    expect(t.kv.count.puts).toBe(2);
  });

  it("rebuilds with the change", async () => {
    const t = setup({ kv: true });
    await t.tick();
    t.raw.exec("UPDATE media SET visibility = 'public' WHERE id = 3");
    t.bump("v2");
    await t.tick();
    expect(t.kv.count.puts).toBe(2);
    expect(t.kv.entries.get(SNAPSHOT_KEY)?.value).toContain("aaaaaaaaa4");
  });

  it("backs off after a failed write instead of rebuilding every minute", async () => {
    const t = setup({ kv: true });
    t.kv.kv.put = async () => {
      throw new Error("KV put failed: daily limit exceeded");
    };
    await t.tick();
    const batches = t.state.batches;
    for (let i = 0; i < 14; i++) {
      t.later();
      await t.tick();
    }
    expect(t.state.batches).toBe(batches);
    t.later(); // 15 minutes
    await t.tick();
    expect(t.state.batches).toBe(batches + 1);
  });

  it("without KV, request handlers refresh at most once a minute per isolate", async () => {
    const t = setup();
    await t.get("/api/media");
    const firsts = t.state.firsts;
    for (let i = 0; i < 5; i++) await t.get("/api/camera");
    expect(t.state.firsts).toBe(firsts);
    t.later();
    await t.get("/api/camera");
    expect(t.state.firsts).toBe(firsts + 1);
  });
});


describe("serving the snapshot while D1 fails", () => {
  const down = async (t: Setup) => {
    await t.get("/api/media");
    await t.tick();
    t.state.down = true;
  };

  for (const kv of [true, false]) {
    describe(kv ? "KV" : "Cache API (no binding)", () => {
      it("answers every endpoint, marked stale", async () => {
        const t = setup({ kv });
        const fresh: Record<string, [number, unknown]> = {};
        for (const p of PATHS) {
          const res = await t.get(p);
          fresh[p] = [res.status, await res.json()];
        }
        if (kv) await t.tick();
        t.state.down = true;
        for (const p of PATHS) {
          const res = await t.get(p);
          expect(res.headers.get("X-Stale")).toBe("d1-error");
          expect(res.headers.get("Cache-Control")).toBe(
            "public, max-age=10, s-maxage=60",
          );
          expect([p, res.status, await res.json()]).toEqual([p, ...fresh[p]]);
        }
      });

      it("answers the RPCs", async () => {
        const t = setup({ kv });
        await down(t);
        const photo = await withLastGood(
          "photo",
          () => getPhotoForImage(t.db, "aaaaaaaaa3"),
          (i) => i.photo("aaaaaaaaa3"),
          t.ctx,
        );
        expect(photo?.file).toBe("/u.png");
        const access = await withLastGood(
          "pathAccess",
          () => getPathAccess(t.db, "/moved/new.png"),
          (i) => i.pathAccess("/moved/new.png"),
          t.ctx,
        );
        expect(access).toMatchObject({
          kind: "photo",
          photo: { file: "/old.png" },
        });
      });
    });
  }

  it("answers HEAD without a body", async () => {
    const t = setup({ kv: true });
    await down(t);
    const res = await t.get("/api/media", "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    expect(res.body).toBeNull();
  });

  it("answers 503 / rethrows when there is no snapshot", async () => {
    const t = setup({ kv: true });
    t.state.down = true;
    const res = await t.get("/api/media");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(
      withLastGood(
        "photo",
        () => getPhotoForImage(t.db, "aaaaaaaaa2"),
        (i) => i.photo("aaaaaaaaa2"),
        t.ctx,
      ),
    ).rejects.toThrow(D1_LIMIT_ERROR);
  });

  it("serves nothing once the admin deleted the snapshot", async () => {
    const t = setup({ kv: true });
    await t.tick();
    // The admin made a photo private: it deleted the snapshot.
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.bump("v2");
    await t.kv.kv.delete(SNAPSHOT_KEY);
    t.state.down = true;
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(503);
  });

  it("is rebuilt without the hidden photo on the next cron run", async () => {
    const t = setup({ kv: true });
    await t.tick();
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.bump("v2");
    await t.kv.kv.delete(SNAPSHOT_KEY);
    await t.tick();
    t.state.down = true;
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
    expect((await t.get("/api/media/aaaaaaaaa3")).status).toBe(200);
  });

  it("a rebuild racing the admin's delete is replaced on the next run", async () => {
    const t = setup({ kv: true });
    t.bump("v1");
    await t.tick();
    const before = t.kv.entries.get(SNAPSHOT_KEY);
    // The admin hides photo 1, deletes the snapshot and bumps the version;
    // a run that read D1 before all that writes its snapshot afterwards.
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    await t.kv.kv.delete(SNAPSHOT_KEY);
    t.bump("v2");
    await t.kv.kv.put(SNAPSHOT_KEY, before?.value ?? "", {
      metadata: before?.metadata,
    });
    await t.tick();
    expect(t.kv.entries.get(SNAPSHOT_KEY)?.value).not.toContain("aaaaaaaaa2");
    t.state.down = true;
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
  });

  it("ignores a snapshot of another format", async () => {
    const t = setup({ kv: true });
    await t.kv.kv.put(SNAPSHOT_KEY, JSON.stringify({ format: 0 }));
    t.state.down = true;
    expect((await t.get("/api/media")).status).toBe(503);
  });
});
