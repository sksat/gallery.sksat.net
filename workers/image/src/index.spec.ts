/**
 * The Worker's handlers with the platform stubbed out: which paths use the
 * edge cache. The admin's private images must never reach it.
 */
import { readFileSync } from "node:fs";
import exifr from "exifr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock("./admin-auth", () => ({
  parseAccessConfig: () => ({}),
  verifyAdminToken: async () => ({ ok: true }),
}));

// wrangler bundles it as bytes (a Data module); Vite would give a URL.
const { SITE_CARD } = vi.hoisted(() => ({
  SITE_CARD: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
}));
vi.mock("./og-fallback.jpg", () => ({ default: SITE_CARD.slice().buffer }));

const { default: worker, AdminImage } = await import("./index");
const { CACHE_STATUS_HEADER } = await import("./cache");

const FILE = "/VRChat/2023-12/a.png";
const ID = "8f4pau5wqb";
const AVIF = "image/avif,image/webp,*/*";

const photo = {
  id: ID,
  file: FILE,
  platform: "w",
  timestamp: null,
  camera: null,
  tags: [],
};

const env = {
  ORIGIN_BASE_URL: "https://bucket.example",
  B2_ENDPOINT: "https://s3.example",
  B2_BUCKET: "bucket",
  B2_REGION: "us-west-002",
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "app-key",
  API: {
    photo: async (id: string) => (id === ID ? photo : null),
    pathAccess: async (path: string) =>
      path === FILE ? { kind: "photo" as const, photo } : null,
  },
};

let store: Map<string, Response>;
let cacheDefault: {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};
let transforms: string[];
let pending: Promise<unknown>[];
const ctx = {
  waitUntil: (p: Promise<unknown>) => void pending.push(p),
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

beforeEach(() => {
  store = new Map();
  pending = [];
  transforms = [];
  cacheDefault = {
    match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, res);
    }),
  };
  vi.stubGlobal("caches", { default: cacheDefault });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      transforms.push(url);
      return new Response("resized", {
        headers: {
          "Content-Type": "image/avif",
          "Cf-Resized": "internal=ok/m",
          "CF-Cache-Status": "MISS",
        },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (path: string, method = "GET") =>
  worker.fetch(
    new Request(`https://gallery.sksat.net${path}`, {
      method,
      headers: { Accept: AVIF },
    }),
    env as never,
    ctx,
  );

describe("public fetch handler", () => {
  it("serves the second request from the edge cache", async () => {
    const first = await get(`/img/${ID}?size=h240`);
    expect(first.status).toBe(200);
    expect(first.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    await Promise.all(pending);
    expect([...store.keys()]).toEqual([
      `https://gallery.sksat.net/img${FILE}?size=h240&format=avif`,
    ]);
    // Never the presigned URL.
    expect([...store.keys()][0]).not.toMatch(/X-Amz/);

    const second = await get(`/img${FILE}?size=h240`);
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(second.headers.get("Vary")).toBe("Accept");
    expect(await second.text()).toBe("resized");
    expect(transforms).toHaveLength(1);
  });

  it("checks access before the cache: a cached photo made private is 404", async () => {
    await get(`/img/${ID}?size=h240`);
    await Promise.all(pending);
    expect(store.size).toBe(1);
    cacheDefault.match.mockClear();
    // The photo stops resolving (made private) while its entry is cached.
    const hidden = {
      ...env,
      API: {
        photo: async () => null,
        pathAccess: async () => null,
      },
    };
    for (const path of [`/img/${ID}?size=h240`, `/img${FILE}?size=h240`]) {
      const res = await worker.fetch(
        new Request(`https://gallery.sksat.net${path}`, {
          headers: { Accept: AVIF },
        }),
        hidden as never,
        ctx,
      );
      expect(res.status, path).toBe(404);
    }
    expect(cacheDefault.match).not.toHaveBeenCalled();
  });

  it("uses a stable origin URL across requests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 18, 12));
    await get(`/img/${ID}?size=h240`);
    vi.setSystemTime(Date.UTC(2026, 10, 20, 12));
    await get(`/img/${ID}?size=h480`);
    vi.useRealTimers();
    await get(`/img/${ID}?size=h480`);
    expect(transforms).toHaveLength(2);
    expect(transforms[0]).toBe(transforms[1]);
  });

  it("does not use the cache for HEAD", async () => {
    const res = await get(`/img/${ID}?size=h240`, "HEAD");
    expect(res.status).toBe(200);
    expect(cacheDefault.match).not.toHaveBeenCalled();
    expect(cacheDefault.put).not.toHaveBeenCalled();
  });
});

describe("the file a photo is resized from", () => {
  const getWith = (e: unknown, path: string) =>
    worker.fetch(
      new Request(`https://gallery.sksat.net${path}`, {
        headers: { Accept: AVIF },
      }),
      e as never,
      ctx,
    );
  const EDIT = "/VRChat/2023-12/a_lightroom.jpg";
  /** The API names a retouched version as the file to resize. */
  const shown = (source: unknown) => {
    const p = { ...photo, source };
    return {
      ...env,
      API: {
        photo: async (id: string) => (id === ID ? p : null),
        pathAccess: async (path: string) =>
          path === FILE ? { kind: "photo" as const, photo: p } : null,
      },
    };
  };

  it("is the API's source, by public id and by path, and keys the edge cache", async () => {
    const e = shown({ storage: "b2", key: EDIT });
    for (const path of [`/img/${ID}?size=h240`, `/img${FILE}?size=h480`]) {
      const res = await getWith(e, path);
      expect(res.status, path).toBe(200);
    }
    expect(transforms).toHaveLength(2);
    for (const t of transforms) expect(t).toContain(EDIT.slice(1));
    await Promise.all(pending);
    expect([...store.keys()]).toEqual([
      `https://gallery.sksat.net/img${EDIT}?size=h240&format=avif`,
      `https://gallery.sksat.net/img${EDIT}?size=h480&format=avif`,
    ]);
  });

  it("is the original when the API gives no source (before media_file)", async () => {
    const res = await getWith(env, `/img/${ID}?size=h240`);
    expect(res.status).toBe(200);
    expect(transforms[0]).toContain(FILE.slice(1));
  });

  it("is not served from R2 yet, nor from an unusable key", async () => {
    for (const source of [
      { storage: "r2", key: EDIT },
      { storage: "b2", key: "../x.png" },
    ]) {
      const e = shown(source);
      expect((await getWith(e, `/img/${ID}?size=h240`)).status).toBe(503);
      expect((await getWith(e, `/img${FILE}?size=h240`)).status).toBe(503);
    }
    expect(transforms).toEqual([]);
  });
});

describe("paths", () => {
  // The API finds a photo by display path; this one was moved, so its
  // bucket key differs.
  const moved = {
    ...env,
    API: {
      ...env.API,
      pathAccess: async (path: string) =>
        path === "/trip/sunset.png"
          ? { kind: "photo" as const, photo: { ...photo, file: FILE } }
          : path === "/camera/vl2/front.png"
            ? { kind: "camera-image" as const, file: path }
            : // A picture that is a photo: its display copy.
              path === "/camera/vl2/7.photo.jpg"
              ? {
                  kind: "camera-image" as const,
                  file: "/.derived/x-1.jpg",
                  source: { storage: "b2" as const, key: "/.derived/x-1.jpg" },
                }
              : path === "/camera/vl2/8.photo.jpg"
                ? {
                    kind: "camera-image" as const,
                    file: "/r2.jpg",
                    source: { storage: "r2" as const, key: "/r2.jpg" },
                  }
                : null,
    },
  };
  const at = (path: string) =>
    worker.fetch(
      new Request(`https://gallery.sksat.net${path}`, {
        headers: { Accept: AVIF },
      }),
      moved as never,
      ctx,
    );

  it("serves a moved photo at its display path, from its bucket key", async () => {
    const res = await at("/img/trip/sunset.png?size=h480");
    expect(res.status).toBe(200);
    expect(transforms[0]).toContain(FILE.slice(1));
    // Its old path is not found.
    expect((await at(`/img${FILE}?size=h480`)).status).toBe(404);
  });

  it("serves camera pictures by their bucket path", async () => {
    const res = await at("/img/camera/vl2/front.png");
    expect(res.status).toBe(200);
    expect(transforms[0]).toContain("camera/vl2/front.png");
  });

  it("serves a picture that is a photo from the file the API names", async () => {
    const res = await at("/img/camera/vl2/7.photo.jpg?size=h480");
    expect(res.status).toBe(200);
    expect(transforms[0]).toContain(".derived/x-1.jpg");
    expect(transforms[0]).not.toContain("7.photo");
    expect((await at("/img/camera/vl2/7.photo.jpg?size=og-site")).status).toBe(
      200,
    );
    // A file in storage the Worker cannot read yet is an error, not a guess.
    expect((await at("/img/camera/vl2/8.photo.jpg")).status).toBe(503);
  });

  it("answers 400 for a bad size or another parameter, 404 for old paths", async () => {
    expect((await at("/img/trip/sunset.png?size=og")).status).toBe(400);
    expect((await at(`/img/${ID}?size=h241`)).status).toBe(400);
    expect((await at(`/img/${ID}?size=h240&x=1`)).status).toBe(400);
    expect((await at(`/img/h240/trip/sunset.png`)).status).toBe(404);
    expect(transforms).toEqual([]);
  });

  it("draws the badge-only card for a camera picture, not for a photo", async () => {
    const card = await at("/img/camera/vl2/front.png?size=og-site");
    expect(card.status).toBe(200);
    expect((await at("/img/trip/sunset.png?size=og-site")).status).toBe(404);
  });

  it("no longer answers the old id form", async () => {
    expect((await at(`/img/h240/${ID}`)).status).toBe(404);
  });
});

describe("public EXIF", () => {
  const webp = new Uint8Array(
    readFileSync(new URL("./fixtures/lossy.webp", import.meta.url)),
  );
  const withMeta = {
    ...photo,
    timestamp: "2026-11-18T01:02:03+09:00",
    timestamp_precision: "date",
    camera: { slug: null, name: "Sony", manufacturer: "Sony", model: null },
    exif: { f_number: 2.8, iso: 100 },
    location: null,
    world: null,
  };
  const metaEnv = (p: unknown) => ({
    ...env,
    API: {
      photo: async () => p,
      pathAccess: async (path: string) =>
        path === "/trip/sunset.png"
          ? { kind: "photo" as const, photo: p }
          : path === "/camera/vl2/front.png"
            ? { kind: "camera-image" as const, file: path }
            : path === "/camera/vl2/7.photo.jpg"
              ? {
                  kind: "camera-image" as const,
                  file: "/r/pic.png",
                  source: { storage: "b2" as const, key: "/r/pic.png" },
                }
              : null,
    },
  });
  const formats: string[] = [];
  const stubWebp = () => {
    formats.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { cf?: { image?: { format?: string } } }) => {
        transforms.push(url);
        formats.push(init?.cf?.image?.format ?? "");
        return new Response(webp, {
          headers: { "Content-Type": "image/webp", "Content-Length": "62" },
        });
      }),
    );
  };
  const getWith = (e: unknown, path: string) =>
    worker.fetch(
      new Request(`https://gallery.sksat.net${path}`, {
        headers: { Accept: AVIF },
      }),
      e as never,
      ctx,
    );

  it("embeds only the public fields, as WebP instead of AVIF", async () => {
    stubWebp();
    const res = await getWith(metaEnv(withMeta), `/img/${ID}?size=w1200`);
    expect(res.status).toBe(200);
    expect(formats).toEqual(["webp"]);
    expect(res.headers.get("Content-Length")).toBeNull();
    // Its own validator, tied to the EXIF in it.
    expect(res.headers.get("ETag")).toMatch(/^W\/"62-[0-9a-f]{16}"$/);
    // exifr does not read WebP: take the EXIF chunk out, parse that.
    const out = new Uint8Array(await res.arrayBuffer());
    const at = Buffer.from(out).indexOf("EXIF");
    const size = new DataView(out.buffer).getUint32(at + 4, true);
    const tiff = await exifr.parse(Buffer.from(out.subarray(at + 8, at + 8 + size)), {
      tiff: true,
      exif: true,
      gps: true,
      translateKeys: false,
      reviveValues: false,
      mergeOutput: false,
    });
    // Make only (the camera's level is "manufacturer"), nothing else.
    expect(tiff.ifd0).toEqual({ 0x010f: "Sony" });
    // Date precision: the time blank (exifr trims the trailing blanks).
    expect(tiff.exif[0x9003]).toBe("2026:11:18   :  :");
    expect(tiff.exif[0x829d]).toBeCloseTo(2.8);
    expect(tiff.exif[0x8827]).toBe(100);
    expect(tiff.gps).toBeUndefined();
    // The edge cache keys on what was embedded.
    await Promise.all(pending);
    expect([...store.keys()][0]).toMatch(/format=webp&exif=[0-9a-f]{16}$/);
  });

  it("embeds the same EXIF in a photo served by its display path", async () => {
    stubWebp();
    const byId = await getWith(metaEnv(withMeta), `/img/${ID}?size=w1200`);
    await Promise.all(pending);
    const byPath = await getWith(
      metaEnv(withMeta),
      "/img/trip/sunset.png?size=w1200",
    );
    expect(formats).toEqual(["webp"]);
    expect(byPath.status).toBe(200);
    // One edge cache entry for both, and the same bytes and validator.
    expect(byPath.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(store.size).toBe(1);
    expect(byPath.headers.get("ETag")).toBe(byId.headers.get("ETag"));
    const out = Buffer.from(await byPath.arrayBuffer());
    expect(out.indexOf("EXIF")).toBeGreaterThan(0);
  });

  it("leaves photos without public metadata, camera pictures and cards alone", async () => {
    stubWebp();
    const res = await getWith(metaEnv(photo), `/img/${ID}?size=w1200`);
    expect(formats).toEqual(["avif"]);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp);
    formats.length = 0;
    const camera = await getWith(
      metaEnv(withMeta),
      "/img/camera/vl2/front.png?size=w1200",
    );
    expect(formats).toEqual(["avif"]);
    expect(new Uint8Array(await camera.arrayBuffer())).toEqual(webp);
    formats.length = 0;
    // Also a picture that is a photo with public metadata.
    const picture = await getWith(
      metaEnv(withMeta),
      "/img/camera/vl2/7.photo.jpg?size=w1200",
    );
    expect(formats).toEqual(["avif"]);
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(webp);
    formats.length = 0;
    const card = await getWith(metaEnv(withMeta), `/img/${ID}?size=og`);
    expect(formats).toEqual(["jpeg"]);
    expect(new Uint8Array(await card.arrayBuffer())).toEqual(webp);
  });

  it("embeds nothing when the photo's embed_exif is off", async () => {
    stubWebp();
    const off = await getWith(
      metaEnv({ ...withMeta, embed_exif: false }),
      `/img/${ID}?size=w1200`,
    );
    // As without metadata: AVIF allowed, the bytes untouched.
    expect(formats).toEqual(["avif"]);
    expect(new Uint8Array(await off.arrayBuffer())).toEqual(webp);
  });
});

describe("AdminImage", () => {
  it("never reads or writes the edge cache", async () => {
    const admin = new AdminImage(ctx as never, env as never);
    // Even with the same image already in the cache.
    await get(`/img/${ID}?size=h240`);
    await Promise.all(pending);
    cacheDefault.match.mockClear();
    cacheDefault.put.mockClear();

    const res = await admin.image("jwt", FILE, "h240", AVIF);
    await Promise.all(pending);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get(CACHE_STATUS_HEADER)).toBeNull();
    expect(cacheDefault.match).not.toHaveBeenCalled();
    expect(cacheDefault.put).not.toHaveBeenCalled();
    expect(transforms).toHaveLength(2);
  });

  it("stat reads the object's first byte and refuses bad paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        transforms.push(`${init?.method} ${url}`);
        return new Response("x", {
          status: 206,
          headers: {
            "content-range": "bytes 0-0/42",
            "x-amz-meta-sha256": "ab",
          },
        });
      }),
    );
    const admin = new AdminImage(ctx as never, env as never);
    expect(await admin.stat("jwt", FILE)).toEqual({
      ok: true,
      stat: { size: 42, etag: null, sha256: "ab" },
    });
    expect(transforms[0]).toMatch(/^GET https:\/\/s3\.example\/bucket\//);
    expect(await admin.stat("jwt", "/../media.json")).toEqual({
      ok: false,
      status: 404,
    });
    expect(transforms).toHaveLength(1);
  });

  it("bytes reads a range of the original and refuses bad arguments", async () => {
    const headers: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        transforms.push(`${init?.method} ${url}`);
        headers.push(new Headers(init?.headers).get("range"));
        return new Response("abc", {
          status: 206,
          headers: { "content-range": "bytes 39-41/42" },
        });
      }),
    );
    const admin = new AdminImage(ctx as never, env as never);
    const got = await admin.bytes("jwt", FILE, { suffix: 3 });
    expect(
      got.ok && got.object && new TextDecoder().decode(got.object.bytes),
    ).toBe("abc");
    expect(got.ok && got.object?.size).toBe(42);
    expect(headers).toEqual(["bytes=-3"]);
    expect(transforms[0]).toMatch(/^GET https:\/\/s3\.example\/bucket\//);
    expect(await admin.bytes("jwt", "/../media.json", { suffix: 3 })).toEqual({
      ok: false,
      status: 404,
    });
    expect(
      await admin.bytes("jwt", FILE, { offset: 0, length: 10 ** 9 }),
    ).toEqual({ ok: false, status: 400 });
    expect(transforms).toHaveLength(1);
  });
});

describe("when resizing fails (e.g. the monthly transformations are used up)", () => {
  /** Plain GETs (no `cf.image`): what the bucket was asked for as-is. */
  let plainGets: string[];
  const failWith = (
    transform: () => Response,
    bucket: () => Response = () =>
      new Response("ORIGINAL", {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": "8",
          "x-amz-meta-sha256": "ab",
        },
      }),
  ) => {
    plainGets = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit & { cf?: unknown }) => {
        if (init?.cf) {
          transforms.push(url);
          return transform();
        }
        plainGets.push(url);
        return bucket();
      }),
    );
  };
  const quota = () => new Response("ERROR 9422", { status: 429 });
  // Some failures answer 2xx with the untransformed original.
  const errOk = () =>
    new Response("ORIGINAL", {
      headers: { "Content-Type": "image/png", "Cf-Resized": "err=9422" },
    });

  it("the public handler answers an error, never the original", async () => {
    for (const transform of [quota, errOk]) {
      failWith(transform);
      for (const path of [
        `/img/${ID}?size=w1920`,
        `/img${FILE}?size=w3840`,
        `/img/${ID}?size=h240`,
      ]) {
        const res = await get(path);
        expect(res.status, path).toBe(502);
        expect(await res.text()).not.toContain("ORIGINAL");
        expect(res.headers.get("X-Image-Fallback")).toBeNull();
      }
      await Promise.all(pending);
      expect(plainGets).toEqual([]);
      expect(cacheDefault.put).not.toHaveBeenCalled();
    }
  });

  it("AdminImage streams the file for the large presets, privately and marked", async () => {
    for (const transform of [quota, errOk]) {
      failWith(transform);
      const admin = new AdminImage(ctx as never, env as never);
      const res = await admin.image("jwt", FILE, "w1920", AVIF);
      await Promise.all(pending);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ORIGINAL");
      expect(res.headers.get("X-Image-Fallback")).toBe("original");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Content-Length")).toBe("8");
      // Only the type and length come from the bucket.
      expect(res.headers.get("x-amz-meta-sha256")).toBeNull();
      // The presigned URL the resize used, fetched as-is.
      expect(plainGets).toHaveLength(1);
      expect(plainGets[0]).toBe(transforms.at(-1));
      expect(plainGets[0]).toMatch(/X-Amz-Signature/);
      expect(cacheDefault.match).not.toHaveBeenCalled();
      expect(cacheDefault.put).not.toHaveBeenCalled();
    }
  });

  it("AdminImage keeps failing for thumbnails and missing files", async () => {
    const admin = new AdminImage(ctx as never, env as never);
    for (const transform of [quota, errOk]) {
      failWith(transform);
      for (const preset of ["h240", "h480"]) {
        const res = await admin.image("jwt", FILE, preset, AVIF);
        expect(res.status, preset).toBe(502);
        expect(await res.text()).not.toContain("ORIGINAL");
      }
      expect(plainGets).toEqual([]);
    }
    failWith(() => new Response("missing", { status: 404 }));
    expect((await admin.image("jwt", FILE, "w1920", AVIF)).status).toBe(404);
    expect(plainGets).toEqual([]);

    // The resize failed and so does the file itself.
    failWith(quota, () => new Response("<Error/>", { status: 404 }));
    const gone = await admin.image("jwt", FILE, "w1920", AVIF);
    expect(gone.status).toBe(404);
    failWith(quota, () => new Response("<Error/>", { status: 500 }));
    const broken = await admin.image("jwt", FILE, "w1920", AVIF);
    expect(broken.status).toBe(502);
    expect(await broken.text()).not.toContain("Error");
    failWith(quota, () => {
      throw new TypeError("network");
    });
    expect((await admin.image("jwt", FILE, "w1920", AVIF)).status).toBe(502);
  });

  it("a card answers the site's card instead, briefly and not stored", async () => {
    for (const transform of [quota, errOk]) {
      failWith(transform);
      for (const path of [
        `/img/${ID}?size=og`,
        `/img/${ID}?size=og-site`,
        "/img/camera/vl2/front.png?size=og-site",
      ]) {
        const res = await worker.fetch(
          new Request(`https://gallery.sksat.net${path}`),
          {
            ...env,
            API: {
              ...env.API,
              pathAccess: async () => ({
                kind: "camera-image" as const,
                file: "/camera/vl2/front.png",
              }),
            },
          } as never,
          ctx,
        );
        expect(res.status, path).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/jpeg");
        expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
        expect(res.headers.get("X-Image-Fallback")).toBe("site-card");
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(SITE_CARD);
      }
      await Promise.all(pending);
      expect(plainGets).toEqual([]);
      expect(cacheDefault.put).not.toHaveBeenCalled();
    }
    // HEAD too.
    const head = await get(`/img/${ID}?size=og`, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("a card that is made is still the real one, stored", async () => {
    const res = await get(`/img/${ID}?size=og`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("resized");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("X-Image-Fallback")).toBeNull();
    await Promise.all(pending);
    expect(cacheDefault.put).toHaveBeenCalledTimes(1);
  });

  it("a public HEAD answers an error too", async () => {
    for (const transform of [quota, errOk]) {
      failWith(transform);
      const res = await get(`/img/${ID}?size=w1920`, "HEAD");
      expect(res.status).toBe(502);
      expect(plainGets).toEqual([]);
    }
  });
});

describe("the site's card (og-fallback.jpg)", () => {
  // X's summary_large_image: JPG/PNG/WEBP/GIF under 5 MB, at least 300x157
  // (2:1 shown; 1200x630 like the made cards).
  it("is a 1200x630 JPEG well under 5 MB", () => {
    const bytes = readFileSync(new URL("./og-fallback.jpg", import.meta.url));
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    // The frame header (SOF0..SOF2) has the height and width.
    let at = 2;
    while (bytes[at + 1] < 0xc0 || bytes[at + 1] > 0xc2) {
      at += 2 + bytes.readUInt16BE(at + 2);
      expect(at).toBeLessThan(bytes.length);
    }
    expect([bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)]).toEqual([
      1200, 630,
    ]);
  });
});
