import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  createMemo,
  dataKey,
  handleGet,
  LATEST_KEY,
  RETRY_MS,
  rpcAnswer,
  VERSION_KEY,
  VERSION_MS,
  type CacheLike,
  type Context,
} from "./last-good";
import {
  CONTENT_VERSION_KEY,
  getPathAccess,
  getPhotoForImage,
} from "./query";
import { respond } from "./respond";
import { parseRoute, type Route } from "./route";
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
    (1, '/camera/cam-a/back.png', NULL, 1);
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
  -- Pictures that are photos: a private one (never shown) and a public one.
  INSERT INTO camera_image (id, camera_id, media_id, position) VALUES
    (10, 3, 3, 0), (11, 1, 1, 2);
`;

/** A D1 that can be switched to failing every query, counting queries. */
const flakyDb = (raw: DatabaseSync) => {
  const inner = d1(raw);
  const state = { down: false, queries: 0 };
  const check = () => {
    state.queries++;
    if (state.down) throw new Error(D1_LIMIT_ERROR);
  };
  const wrap = (st: D1PreparedStatement): D1PreparedStatement =>
    ({
      bind: (...args: unknown[]) => wrap(st.bind(...args)),
      first: async () => {
        check();
        return st.first();
      },
      // Run by batch (counted there), or on its own.
      all: async () => {
        if (state.down) throw new Error(D1_LIMIT_ERROR);
        return st.all();
      },
    }) as unknown as D1PreparedStatement;
  const db = {
    prepare: (sql: string) => wrap(inner.prepare(sql)),
    batch: async (stmts: D1PreparedStatement[]) => {
      check();
      return inner.batch(stmts);
    },
  } as unknown as D1Database;
  return { db, state };
};

/** caches.default stand-in, honouring s-maxage, on a fake clock. */
const memoryCache = (clock: { now: number }) => {
  const entries = new Map<string, { res: Response; until: number }>();
  const url = (key: Request | string) =>
    typeof key === "string" ? key : key.url;
  const cache: CacheLike = {
    match: async (key) => {
      const e = entries.get(url(key));
      if (!e || e.until <= clock.now) return undefined;
      return e.res.clone();
    },
    put: async (key, res) => {
      const age = Number(
        /s-maxage=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1],
      );
      entries.set(url(key), { res, until: clock.now + age * 1000 });
    },
  };
  return { cache, entries };
};

const setup = () => {
  const raw = migratedDb();
  raw.exec(FIXTURE);
  const { db, state } = flakyDb(raw);
  const clock = { now: 1_000_000 };
  const { cache, entries } = memoryCache(clock);
  const pending: Promise<unknown>[] = [];
  const settle = async () => {
    while (pending.length > 0) await Promise.all(pending.splice(0));
  };
  /** An isolate of this data centre (they share the cache). */
  const isolate = (): Context => ({
    cache,
    db,
    waitUntil: (p) => void pending.push(p),
    memo: createMemo(),
    now: () => clock.now,
  });
  const ctx = isolate();
  const get = async (path: string, c = ctx, method = "GET") => {
    const res = await handleGet(
      new Request(`https://gallery.sksat.net${path}`, { method }),
      (route) => respond(db, route),
      c,
    );
    await settle();
    return res;
  };
  const photo = async (id: string, c = ctx) => {
    const v = await rpcAnswer(
      `rpc/photo/${id}`,
      () => getPhotoForImage(db, id),
      c,
    );
    await settle();
    return v;
  };
  const pathAccess = async (path: string, c = ctx) => {
    const v = await rpcAnswer(
      `rpc/path/${encodeURIComponent(path)}`,
      () => getPathAccess(db, path),
      c,
    );
    await settle();
    return v;
  };
  /** As the admin does after a change. */
  const bump = (v: string) =>
    raw
      .prepare(
        `INSERT INTO setting (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(CONTENT_VERSION_KEY, JSON.stringify(v));
  const later = (ms = VERSION_MS) => {
    clock.now += ms;
  };
  return {
    raw,
    db,
    state,
    entries,
    clock,
    ctx,
    isolate,
    get,
    photo,
    pathAccess,
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
const IDS = PATHS.filter((p) => p.startsWith("/api/media/")).map((p) =>
  p.slice("/api/media/".length),
);
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
  "/camera/cam-c/10.photo.jpg",
  "/camera/cam-a/11.photo.jpg",
  "/nothing.png",
];

/** Every answer, as [status, body] or the RPC value. */
const everything = async (t: Setup, c = t.ctx) => {
  const out: Record<string, unknown> = {};
  for (const p of PATHS) {
    const res = await t.get(p, c);
    out[p] = [res.status, await res.json()];
  }
  for (const id of IDS) out[`photo ${id}`] = await t.photo(id, c);
  for (const p of IMG_PATHS) out[`path ${p}`] = await t.pathAccess(p, c);
  return out;
};

/** The same, straight from D1. */
const live = async (t: Setup) => {
  const out: Record<string, unknown> = {};
  for (const p of PATHS) {
    const e = await respond(t.db, parseRoute(p) as Route);
    out[p] = [e.status, JSON.parse(e.body)];
  }
  for (const id of IDS) out[`photo ${id}`] = await getPhotoForImage(t.db, id);
  for (const p of IMG_PATHS) out[`path ${p}`] = await getPathAccess(t.db, p);
  return out;
};

describe("answers", () => {
  it("are what D1 answers, built and then from the cache", async () => {
    const t = setup();
    const fresh = await live(t);
    expect(await everything(t)).toEqual(fresh);
    expect(await everything(t)).toEqual(fresh);
  });

  it("carry the API's headers", async () => {
    const t = setup();
    for (const _ of [1, 2]) {
      const res = await t.get("/api/media");
      expect(res.headers.get("Cache-Control")).toBe(
        "public, max-age=10, s-maxage=60",
      );
      expect(res.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(res.headers.get("X-Stale")).toBeNull();
    }
    const head = await t.get("/api/media", t.ctx, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });
});

describe("D1 reads", () => {
  it("none while the version is unchanged, then one row a minute", async () => {
    const t = setup();
    await everything(t);
    t.state.queries = 0;
    for (let i = 0; i < 5; i++) await everything(t);
    expect(t.state.queries).toBe(0);
    t.later();
    await everything(t);
    expect(t.state.queries).toBe(1); // the version row
  });

  it("other isolates of the data centre share the version check", async () => {
    const t = setup();
    await everything(t);
    t.state.queries = 0;
    await everything(t, t.isolate());
    await everything(t, t.isolate());
    expect(t.state.queries).toBe(0);
  });

  it("an unknown id reaches D1 once per version", async () => {
    const t = setup();
    await t.get("/api/media");
    t.state.queries = 0;
    for (let i = 0; i < 5; i++) {
      expect((await t.get("/api/media/zzzzzzzzzz")).status).toBe(404);
      expect(await t.photo("zzzzzzzzzz")).toBeNull();
      expect(await t.pathAccess("/scan/x.png")).toBeNull();
    }
    expect(t.state.queries).toBe(3);
  });

  it("a malformed id never reaches D1", async () => {
    const t = setup();
    await t.get("/api/media");
    t.state.queries = 0;
    expect((await t.get("/api/media/not-an-id")).status).toBe(404);
    expect(t.state.queries).toBe(0);
  });
});

describe("after an admin change", () => {
  it("new answers within a minute", async () => {
    const t = setup();
    const before = await everything(t);
    t.raw.exec("UPDATE media SET visibility = 'public' WHERE id = 3");
    t.bump("v2");
    expect(await everything(t)).toEqual(before);
    t.later();
    expect(await everything(t)).toEqual(await live(t));
    expect(
      ((await (await t.get("/api/media")).json()) as { id: string }[]).map(
        (p) => p.id,
      ),
    ).toContain("aaaaaaaaa4");
  });

  it("a hidden photo is gone within a minute", async () => {
    const t = setup();
    await everything(t);
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.bump("v2");
    t.later();
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
    expect(await t.photo("aaaaaaaaa2")).toBeNull();
    expect(await t.pathAccess("/p1.png")).toBeNull();
    expect(JSON.stringify(await (await t.get("/api/media")).json())).not.toContain(
      "aaaaaaaaa2",
    );
  });
});

describe("while D1 fails", () => {
  it("answers from the newest version seen, marked stale", async () => {
    const t = setup();
    const fresh = await everything(t);
    t.later();
    t.state.down = true;
    const res = await t.get("/api/media");
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    // A new isolate too (it finds the version in the data centre's cache).
    expect(await everything(t, t.isolate())).toEqual(fresh);
  });

  it("does not retry D1 on every request", async () => {
    const t = setup();
    await everything(t);
    t.later();
    t.state.down = true;
    t.state.queries = 0;
    for (let i = 0; i < 10; i++) await t.get("/api/media");
    expect(t.state.queries).toBe(1);
    t.later(RETRY_MS);
    await t.get("/api/media");
    expect(t.state.queries).toBe(2);
  });

  it("answers 503 / rethrows what was never built", async () => {
    const t = setup();
    await t.get("/api/media");
    t.later();
    t.state.down = true;
    const res = await t.get("/api/camera");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(t.photo("aaaaaaaaa2")).rejects.toThrow();
  });

  it("answers 503 with nothing cached", async () => {
    const t = setup();
    t.state.down = true;
    expect((await t.get("/api/media")).status).toBe(503);
    await expect(t.photo("aaaaaaaaa2")).rejects.toThrow(D1_LIMIT_ERROR);
  });

  it("never falls back to answers from before a newer version", async () => {
    const t = setup();
    await everything(t);
    // The admin hides photo 1; this data centre sees the new version...
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.bump("v2");
    t.later();
    await t.get("/api/camera");
    // ...and D1 fails before the photo was asked for again.
    t.later();
    t.state.down = true;
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(503);
    await expect(t.photo("aaaaaaaaa2")).rejects.toThrow();
    // An isolate idle since the old version also uses the newest one.
    const idle = t.isolate();
    expect((await t.get("/api/media/aaaaaaaaa2", idle)).status).toBe(503);
    expect(t.entries.has(LATEST_KEY)).toBe(true);
    expect(t.entries.has(VERSION_KEY)).toBe(true);
  });
});

describe("edge cases", () => {
  it("a version with odd characters keys entries apart", async () => {
    const t = setup();
    t.bump('a/b%2F"c');
    expect(await everything(t)).toEqual(await live(t));
    t.bump("a");
    t.later();
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
  });

  it("an older version read never replaces a newer one", async () => {
    const t = setup();
    t.bump("v1");
    const slow = t.isolate();
    // The admin hides photo 1 and bumps; a fast isolate reads v2...
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.bump("v2");
    t.later(1000);
    await t.get("/api/media/aaaaaaaaa2");
    // ...then an isolate whose read of v1 started earlier stores it.
    t.bump("v1");
    t.clock.now -= 500;
    await t.get("/api/camera", slow);
    t.clock.now += 500;
    t.later();
    t.state.down = true;
    const res = await t.get("/api/media/aaaaaaaaa2", t.isolate());
    // From v2: the photo is hidden (404 kept for v2), not v1's answer.
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
  });

  it("rebuilds an entry after a day even without a new version", async () => {
    const t = setup();
    await t.get("/api/media/aaaaaaaaa2");
    // A change whose version bump was lost.
    t.raw.exec("UPDATE media SET visibility = 'private' WHERE id = 1");
    t.later(23 * 60 * 60 * 1000);
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(200);
    t.later(60 * 60 * 1000);
    expect((await t.get("/api/media/aaaaaaaaa2")).status).toBe(404);
  });

  it("marks cached answers stale while D1 is known to fail", async () => {
    const t = setup();
    await t.get("/api/media");
    t.state.down = true;
    // An entry fails to build within the version's minute...
    expect((await t.get("/api/camera")).status).toBe(503);
    // ...so a cached one is marked stale too.
    const res = await t.get("/api/media");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBe("d1-error");
    t.state.down = false;
    t.later(RETRY_MS);
    expect((await t.get("/api/media")).headers.get("X-Stale")).toBeNull();
  });
});

describe("CPU", () => {
  /** A data set like the real one: full metadata on every photo. */
  const big = (n: number) => {
    const raw = migratedDb();
    raw.exec(FIXTURE);
    const insert = raw.prepare(
      `INSERT INTO media (public_id, file, platform, timestamp, tags, visibility, camera_id, exif, latitude, longitude, world_id, world_name, metadata_visibility)
       VALUES (?, ?, 'VRChat', ?, '["pub","a-longer-tag-name"]', 'public', 1, ?, 35.6812, 139.7671, 'wrld_0123456789abcdef0123456789abcdef', 'Some World Name', '{"file_name":"path","location":"exact","exif":"all"}')`,
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
    for (let i = 0; i < n; i++) {
      let id = "";
      for (let k = 0, m = i; k < 10; k++, m = Math.floor(m / 31)) {
        id += letters[m % 31];
      }
      insert.run(
        id,
        `/VRChat/2026-11/VRChat_2026-11-19_12-34-56.${String(i).padStart(4, "0")}_7680x4320.png`,
        `2026-11-19T12:34:${String(i % 60).padStart(2, "0")}+09:00`,
        exif,
      );
    }
    return d1(raw);
  };

  /** A D1 whose batches answer from memory: the Worker's own CPU only. */
  const preRead = (db: D1Database): D1Database => {
    let replay: D1Result[] | null = null;
    return {
      prepare: (sql: string) => db.prepare(sql),
      batch: async (stmts: D1PreparedStatement[]) =>
        (replay ??= await db.batch(stmts)),
    } as unknown as D1Database;
  };

  const best = async (f: () => Promise<unknown>) => {
    await f(); // warm up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await f();
      times.push(performance.now() - started);
    }
    return Math.min(...times);
  };

  for (const n of [2000, 5000]) {
    it(`/api/media with ${n} photos`, async () => {
      const route = parseRoute("/api/media") as Route;
      const db = preRead(big(n));
      const built = await respond(db, route);
      // Projecting the rows and serialising them (D1 reads the rows).
      const build = await best(() => respond(db, route));
      // A request answered from the cache: the version from the memo, the
      // entry's body passed on as is.
      const clock = { now: 0 };
      const { cache } = memoryCache(clock);
      const ctx: Context = {
        cache,
        db,
        waitUntil: () => {},
        memo: { version: { value: "v", readAt: 0 }, retryAt: 0, error: null },
        now: () => clock.now,
      };
      await cache.put(
        dataKey("v", "http/api/media"),
        new Response(built.body, {
          headers: { "Cache-Control": "public, s-maxage=60" },
        }),
      );
      const hit = await best(async () => {
        const res = await handleGet(
          new Request("https://gallery.sksat.net/api/media"),
          () => {
            throw new Error("not from D1");
          },
          ctx,
        );
        expect(res.status).toBe(200); // from the cache: D1 would throw
        await res.arrayBuffer();
      });
      console.info(
        `/api/media, ${n} photos (${(built.body.length / 1e6).toFixed(2)} MB): build ${build.toFixed(1)} ms, from the cache ${hit.toFixed(2)} ms`,
      );
      // Timings are printed, not asserted: they depend on the machine and
      // on what else runs.
    });
  }
});
