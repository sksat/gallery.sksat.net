import { describe, expect, it } from "vitest";
import {
  handleGet,
  LAST_GOOD_TTL,
  lastGoodKey,
  withLastGood,
  type CacheLike,
  type Context,
  type Respond,
} from "./last-good";
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
  return { db, state };
};

/** caches.default stand-in: by URL, recording each put's Cache-Control. */
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

const setup = () => {
  const { db, state } = flakyDb();
  const { cache, entries } = memoryCache();
  const pending: Promise<unknown>[] = [];
  const ctx: Context = { cache, waitUntil: (p) => void pending.push(p) };
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
  const get = async (path: string, host = "https://gallery.sksat.net") => {
    const res = await handleGet(new Request(host + path), respond, ctx);
    await Promise.all(pending.splice(0));
    return res;
  };
  /** Forget the minute-long edge cache, as when it expires. */
  const expireEdge = () => {
    for (const url of entries.keys()) {
      if (!url.includes("/last-good/")) entries.delete(url);
    }
  };
  return { db, state, entries, ctx, pending, get, expireEdge };
};

describe("handleGet", () => {
  it("keeps a week-long last-good copy of a successful answer", async () => {
    const t = setup();
    const res = await t.get("/api/media");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stale")).toBeNull();
    const copy = t.entries.get(lastGoodKey("/api/media").url);
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
    expect(await res.json()).toEqual(fresh);
    // The copy itself is left as it was.
    expect(
      t.entries.get(lastGoodKey("/api/media").url)?.headers.get("X-Stale"),
    ).toBeNull();
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

describe("withLastGood", () => {
  const photo = (t: ReturnType<typeof setup>, id: string) =>
    withLastGood(
      `/rpc/photo/${id}`,
      () => getPhotoForImage(t.db, id),
      t.ctx,
    ).finally(() => Promise.all(t.pending.splice(0)));

  it("returns the result and keeps a copy", async () => {
    const t = setup();
    const fresh = await photo(t, "aaaaaaaaa3");
    expect(fresh?.file).toBe("/u.png");
    const copy = t.entries.get(lastGoodKey("/rpc/photo/aaaaaaaaa3").url);
    expect(copy?.headers.get("Cache-Control")).toBe(
      `public, s-maxage=${LAST_GOOD_TTL}`,
    );
  });

  it("returns the copy while D1 fails", async () => {
    const t = setup();
    const fresh = await photo(t, "aaaaaaaaa3");
    t.state.down = true;
    expect(await photo(t, "aaaaaaaaa3")).toEqual(fresh);
  });

  it("keeps null results too", async () => {
    const t = setup();
    expect(await photo(t, "aaaaaaaaa9")).toBeNull();
    t.state.down = true;
    expect(await photo(t, "aaaaaaaaa9")).toBeNull();
  });

  it("rethrows the D1 error when there is no copy", async () => {
    const t = setup();
    t.state.down = true;
    await expect(photo(t, "aaaaaaaaa3")).rejects.toThrow(D1_LIMIT_ERROR);
  });
});
