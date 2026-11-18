/**
 * The Worker's handlers with the platform stubbed out: which paths use the
 * edge cache. The admin's private images must never reach it.
 */
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
    fetch: async (req: Request) =>
      new URL(req.url).pathname === `/api/media/${ID}`
        ? Response.json(photo)
        : new Response("Not Found", { status: 404 }),
    fileAccess: async (file: string) =>
      file === FILE ? { kind: "photo" as const, photo } : null,
  },
};

let store: Map<string, Response>;
let cacheDefault: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
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
    const first = await get(`/img/h240/${ID}`);
    expect(first.status).toBe(200);
    expect(first.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    await Promise.all(pending);
    expect([...store.keys()]).toEqual([
      `https://gallery.sksat.net/img/h240${FILE}?format=avif`,
    ]);
    // Never the presigned URL.
    expect([...store.keys()][0]).not.toMatch(/X-Amz/);

    const second = await get(`/img/h240${FILE}`);
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(second.headers.get("Vary")).toBe("Accept");
    expect(await second.text()).toBe("resized");
    expect(transforms).toHaveLength(1);
  });

  it("checks access before the cache: a cached photo made private is 404", async () => {
    await get(`/img/h240/${ID}`);
    await Promise.all(pending);
    expect(store.size).toBe(1);
    cacheDefault.match.mockClear();
    // The photo stops resolving (made private) while its entry is cached.
    const hidden = {
      ...env,
      API: {
        fetch: async () => new Response("Not Found", { status: 404 }),
        fileAccess: async () => null,
      },
    };
    for (const path of [`/img/h240/${ID}`, `/img/h240${FILE}`]) {
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
    await get(`/img/h240/${ID}`);
    vi.setSystemTime(Date.UTC(2026, 10, 20, 12));
    await get(`/img/h480/${ID}`);
    vi.useRealTimers();
    await get(`/img/h480/${ID}`);
    expect(transforms).toHaveLength(2);
    expect(transforms[0]).toBe(transforms[1]);
  });

  it("does not use the cache for HEAD", async () => {
    const res = await get(`/img/h240/${ID}`, "HEAD");
    expect(res.status).toBe(200);
    expect(cacheDefault.match).not.toHaveBeenCalled();
    expect(cacheDefault.put).not.toHaveBeenCalled();
  });
});

describe("a photo whose file name is not public", () => {
  // The HTTP API leaves the file out; the photo RPC has it; the file is
  // not served by path.
  const hiddenName = {
    ...env,
    API: {
      fetch: async () => Response.json({ ...photo, file: null }),
      photo: async (id: string) => (id === ID ? photo : null),
      fileAccess: async () => null,
    },
  };
  const getWith = (e: unknown, path: string) =>
    worker.fetch(
      new Request(`https://gallery.sksat.net${path}`, {
        headers: { Accept: AVIF },
      }),
      e as never,
      ctx,
    );

  it("is served by public id through the RPC", async () => {
    const res = await getWith(hiddenName, `/img/h240/${ID}`);
    expect(res.status).toBe(200);
    expect(transforms[0]).toContain(FILE.slice(1));
  });

  it("is not served by its bucket path", async () => {
    expect((await getWith(hiddenName, `/img/h240${FILE}`)).status).toBe(404);
    expect(transforms).toEqual([]);
  });

  it("uses only HTTP (cached by the API) while it has the file", async () => {
    // Like the API Worker from before the photo RPC.
    const rpc = vi.fn(async () => {
      throw new TypeError("The RPC receiver does not implement the method");
    });
    const old = { ...env, API: { ...env.API, photo: rpc } };
    expect((await getWith(old, `/img/h240/${ID}`)).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    // ...and fails (503) for a hidden name, rather than guessing.
    const oldHidden = { ...hiddenName, API: { ...hiddenName.API, photo: old.API.photo } };
    expect((await getWith(oldHidden, `/img/h240/${ID}`)).status).toBe(503);
  });
});

describe("AdminImage", () => {
  it("never reads or writes the edge cache", async () => {
    const admin = new AdminImage(ctx as never, env as never);
    // Even with the same image already in the cache.
    await get(`/img/h240/${ID}`);
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
});
