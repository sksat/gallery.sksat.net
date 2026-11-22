import { describe, expect, it, vi } from "vitest";

import { createMemo, type CacheLike, type Context } from "./last-good";
import { d1, migratedDb } from "./sqlite-d1.test-helper";
import {
  FAILURE_TTL,
  imageUrlOf,
  linkedWorldId,
  parseWorldPage,
  PREVIEW_TTL,
  worldPreview,
  type PreviewContext,
} from "./world";
import { handleWorldGet, photoWorldPreview } from "./world-route";

const WORLD = "wrld_00ee7c47-f767-4115-ae24-6d483e864d48";

/** The head of a world page on vrchat.com, as it is served. */
const PAGE = `<!doctype html><html><head>
<meta name="description" content="江ノ島 七里ヶ浜 by てぃーどらごん - a virtual reality world on VRChat">
<meta name="twitter:title" content="江ノ島 七里ヶ浜 by てぃーどらごん">
<meta name="og:title" content="江ノ島 七里ヶ浜 by てぃーどらごん">
<meta name="og:image" content="https://api.vrchat.cloud/api/1/file/file_f717cb09-03ec-4904-8072-874e0f670744/2/file">
<meta name="og:image:alt" content="A preview image of VRChat world &quot;江ノ島 七里ヶ浜&quot; by てぃーどらごん">
<meta name="og:description" content="知ってますか？ 人の目の高さから見える水平線までの距離は、約四キロメートルなんですよ">
<title>VRChat - Home</title></head><body></body></html>`;

describe("parseWorldPage", () => {
  it("reads the name, author, description and picture", () => {
    expect(parseWorldPage(PAGE)).toEqual({
      name: "江ノ島 七里ヶ浜",
      author: "てぃーどらごん",
      description:
        "知ってますか？ 人の目の高さから見える水平線までの距離は、約四キロメートルなんですよ",
      image:
        "https://api.vrchat.cloud/api/1/file/file_f717cb09-03ec-4904-8072-874e0f670744/2/file",
    });
  });

  it("splits the title at its last ' by ' without the alt text", () => {
    const page = `<meta property="og:title" content="Stand by Me by A &amp; B">`;
    expect(parseWorldPage(page)).toEqual({
      name: "Stand by Me",
      author: "A & B",
      description: null,
      image: null,
    });
  });

  it("is null without a name", () => {
    expect(parseWorldPage("<html></html>")).toBeNull();
  });
});

describe("imageUrlOf", () => {
  it("takes https pictures on VRChat's file servers only", () => {
    expect(imageUrlOf("https://files.vrchat.cloud/a.png")).toBe(
      "https://files.vrchat.cloud/a.png",
    );
    expect(imageUrlOf("http://api.vrchat.cloud/a")).toBeNull();
    expect(imageUrlOf("https://example.com/a.png")).toBeNull();
    expect(imageUrlOf("https://api.vrchat.cloud.example.com/a")).toBeNull();
    expect(imageUrlOf("not a url")).toBeNull();
    expect(imageUrlOf(undefined)).toBeNull();
  });
});

describe("linkedWorldId", () => {
  it("is the world id of a projected photo, if any", () => {
    expect(linkedWorldId({ world: { id: WORLD, name: "x" } })).toBe(WORLD);
    expect(linkedWorldId({ world: { id: null, name: "x" } })).toBeNull();
    expect(linkedWorldId({ world: { id: "wrld_../evil" } })).toBeNull();
    expect(linkedWorldId({ world: null })).toBeNull();
    expect(linkedWorldId(null)).toBeNull();
  });
});

/** caches.default stand-in that records each entry's s-maxage. */
const memoryCache = () => {
  const entries = new Map<string, { body: string; ttl: number }>();
  const cache: CacheLike & PreviewContext["cache"] = {
    match: async (key) => {
      const e = entries.get(typeof key === "string" ? key : key.url);
      return e ? new Response(e.body) : undefined;
    },
    put: async (key, res) => {
      entries.set(typeof key === "string" ? key : key.url, {
        body: await res.text(),
        ttl: Number(
          /s-maxage=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1],
        ),
      });
    },
  };
  return { cache, entries };
};

const previewSetup = (page: () => Response | Promise<Response>) => {
  const { cache, entries } = memoryCache();
  const pending: Promise<unknown>[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return page();
  });
  const ctx: PreviewContext = {
    cache,
    fetch: fetchFn as unknown as typeof fetch,
    waitUntil: (p) => void pending.push(p),
    origin: "https://vrchat.test",
  };
  const settle = () => Promise.all(pending.splice(0));
  return { ctx, entries, fetchFn, settle, cache };
};

describe("worldPreview", () => {
  it("reads the page once and keeps it for a week", async () => {
    const s = previewSetup(() => new Response(PAGE));
    const a = await worldPreview(WORLD, s.ctx);
    await s.settle();
    const b = await worldPreview(WORLD, s.ctx);
    expect(a?.name).toBe("江ノ島 七里ヶ浜");
    expect(b).toEqual(a);
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
    expect(String(s.fetchFn.mock.calls[0][0])).toBe(
      `https://vrchat.test/home/world/${WORLD}`,
    );
    expect([...s.entries.values()][0].ttl).toBe(PREVIEW_TTL);
  });

  it("remembers a failure briefly", async () => {
    const s = previewSetup(() => new Response("gone", { status: 404 }));
    expect(await worldPreview(WORLD, s.ctx)).toBeNull();
    await s.settle();
    expect(await worldPreview(WORLD, s.ctx)).toBeNull();
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
    expect([...s.entries.values()][0].ttl).toBe(FAILURE_TTL);

    const t = previewSetup(() => Promise.reject(new Error("network")));
    expect(await worldPreview(WORLD, t.ctx)).toBeNull();

    // A redirect is not followed anywhere.
    const r = previewSetup(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.com/" },
        }),
    );
    expect(await worldPreview(WORLD, r.ctx)).toBeNull();
    expect(r.fetchFn).toHaveBeenCalledTimes(1);
    expect(r.fetchFn.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("reads no more of a page than its head needs", async () => {
    // One huge chunk: the tags first, then 1 MB more.
    const s = previewSetup(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode(PAGE + " ".repeat(1024 * 1024)),
              );
              c.close();
            },
          }),
        ),
    );
    expect((await worldPreview(WORLD, s.ctx))?.name).toBe("江ノ島 七里ヶ浜");
  });

  it("never fetches for a malformed id", async () => {
    const s = previewSetup(() => new Response(PAGE));
    expect(await worldPreview("wrld_x/../../admin", s.ctx)).toBeNull();
    expect(s.fetchFn).not.toHaveBeenCalled();
  });
});

const FIXTURE = `
  INSERT INTO media (id, public_id, file, path, platform, visibility, world_id, world_name, metadata_visibility) VALUES
    (1, 'aaaaaaaaa2', '/a.png', '/a.png', 'VRChat', 'public', '${WORLD}', 'Enoshima', '{"world":"link"}'),
    (2, 'aaaaaaaaa3', '/b.png', '/b.png', 'VRChat', 'public', '${WORLD}', 'Enoshima', '{"world":"name"}'),
    (3, 'aaaaaaaaa4', '/c.png', '/c.png', 'VRChat', 'private', '${WORLD}', 'Enoshima', '{"world":"link"}'),
    (4, 'aaaaaaaaa5', '/d.png', '/d.png', 'VRChat', 'unlisted', '${WORLD}', 'Enoshima', '{"world":"link"}');
`;

describe("the world preview of a photo", () => {
  const setup = () => {
    const raw = migratedDb();
    raw.exec(FIXTURE);
    const s = previewSetup(() => new Response(PAGE));
    const ctx: Context = {
      cache: s.cache,
      db: d1(raw),
      waitUntil: s.ctx.waitUntil,
      memo: createMemo(),
    };
    return { ...s, api: ctx };
  };

  it("is given for a public or unlisted photo that links its world", async () => {
    const s = setup();
    const res = await handleWorldGet(
      new Request("https://gallery.sksat.net/api/media/aaaaaaaaa2/world"),
      "aaaaaaaaa2",
      s.api,
      s.ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({
      name: "江ノ島 七里ヶ浜",
      author: "てぃーどらごん",
      description: expect.stringContaining("水平線") as unknown,
      image: true,
    });
    const unlisted = await photoWorldPreview("aaaaaaaaa5", s.api, s.ctx);
    expect(unlisted).toMatchObject({ name: "江ノ島 七里ヶ浜" });
  });

  it("is never read for a world shown by name only, or a private photo", async () => {
    const s = setup();
    for (const id of ["aaaaaaaaa3", "aaaaaaaaa4", "zzzzzzzzzz"]) {
      const res = await handleWorldGet(
        new Request(`https://gallery.sksat.net/api/media/${id}/world`),
        id,
        s.api,
        s.ctx,
      );
      expect(res.status, id).toBe(404);
    }
    expect(s.fetchFn).not.toHaveBeenCalled();
  });
});
