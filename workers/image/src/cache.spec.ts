import { describe, expect, it, vi } from "vitest";
import {
  CACHE_STATUS_HEADER,
  edgeCacheKey,
  isStorable,
  withEdgeCache,
  type EdgeCache,
} from "./cache";

const ORIGIN = "https://gallery.sksat.net";
const FILE = "/VRChat/2023-12/a.png";
const AVIF = "image/avif,image/webp,*/*";
const WEBP = "image/webp,*/*";

/** An in-memory stand-in for caches.default. */
const memoryCache = () => {
  const store = new Map<string, Response>();
  const cache: EdgeCache = {
    match: vi.fn(async (req: RequestInfo | URL) => {
      const hit = store.get(new Request(req).url);
      return hit?.clone();
    }) as EdgeCache["match"],
    put: vi.fn(async (req: RequestInfo | URL, res: Response) => {
      store.set(new Request(req).url, res);
    }) as EdgeCache["put"],
  };
  return { cache, store };
};

const image = (headers: Record<string, string> = {}, status = 200) =>
  new Response("img", {
    status,
    headers: {
      "Content-Type": "image/avif",
      "Cache-Control": "public, max-age=3600",
      "Cf-Resized": "internal=ok/m q=0",
      "CF-Cache-Status": "MISS",
      Vary: "Accept",
      ...headers,
    },
  });

describe("edgeCacheKey", () => {
  it("keys on the path and the negotiated format, nothing from the origin URL", () => {
    expect(edgeCacheKey(ORIGIN, "h240", FILE, AVIF)).toBe(
      `${ORIGIN}/img/h240${FILE}?format=avif`,
    );
    expect(edgeCacheKey(ORIGIN, "h240", FILE, WEBP)).toBe(
      `${ORIGIN}/img/h240${FILE}?format=webp`,
    );
    expect(edgeCacheKey(ORIGIN, "h240", FILE, null)).toBe(
      `${ORIGIN}/img/h240${FILE}?format=jpeg`,
    );
  });

  it("separates presets and files", () => {
    const keys = new Set([
      edgeCacheKey(ORIGIN, "h240", FILE, AVIF),
      edgeCacheKey(ORIGIN, "h480", FILE, AVIF),
      edgeCacheKey(ORIGIN, "h240", "/VRChat/2023-12/b.png", AVIF),
    ]);
    expect(keys.size).toBe(3);
  });

  it("keys cards as JPEG whatever the Accept, og also by caption", () => {
    expect(edgeCacheKey(ORIGIN, "og-site", FILE, AVIF)).toBe(
      `${ORIGIN}/img/og-site${FILE}?format=jpeg`,
    );
    // og-site draws no caption, so none is in its key.
    expect(
      edgeCacheKey(ORIGIN, "og-site", FILE, AVIF, { primary: "x" }),
    ).toBe(`${ORIGIN}/img/og-site${FILE}?format=jpeg`);
    const a = edgeCacheKey(ORIGIN, "og", FILE, AVIF, {
      primary: "2023-12-16 23:12 JST",
      secondary: "Camera · #VRChat",
    });
    const u = new URL(a);
    expect(u.pathname).toBe(`/img/og${FILE}`);
    expect(u.searchParams.get("format")).toBe("jpeg");
    expect(u.searchParams.get("primary")).toBe("2023-12-16 23:12 JST");
    expect(u.searchParams.get("secondary")).toBe("Camera · #VRChat");
    expect(
      edgeCacheKey(ORIGIN, "og", FILE, AVIF, { primary: "other" }),
    ).not.toBe(a);
  });
});

describe("isStorable", () => {
  it("accepts a transformed public 200", () => {
    expect(isStorable(image())).toBe(true);
  });

  it("refuses private, no-store and unmarked responses", () => {
    for (const cc of [
      "private, max-age=3600",
      "public, no-store",
      "no-cache",
      "max-age=3600",
    ]) {
      expect(isStorable(image({ "Cache-Control": cc })), cc).toBe(false);
    }
    expect(isStorable(new Response("img", { status: 200 }))).toBe(false);
  });

  it("refuses errors, 404s and failed transforms", () => {
    expect(isStorable(image({}, 404))).toBe(false);
    expect(isStorable(image({}, 502))).toBe(false);
    expect(isStorable(image({}, 206))).toBe(false);
    expect(isStorable(image({ "Cf-Resized": "err=9422" }))).toBe(false);
    expect(isStorable(image({ "Set-Cookie": "a=b" }))).toBe(false);
  });
});

describe("withEdgeCache", () => {
  const KEY = `${ORIGIN}/img/h240${FILE}?format=avif`;

  it("produces once, stores in the background, then serves the hit", async () => {
    const { cache, store } = memoryCache();
    const pending: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => void pending.push(p);
    const produce = vi.fn(async () => ({ response: image(), store: true }));

    const first = await withEdgeCache(cache, KEY, "Accept", waitUntil, produce);
    expect(first.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    expect(await first.text()).toBe("img");
    await Promise.all(pending);
    expect(pending).toHaveLength(1);
    // Stored without the per-request headers.
    const stored = store.get(KEY)!;
    expect(stored.headers.get("Vary")).toBeNull();
    expect(stored.headers.get("CF-Cache-Status")).toBeNull();
    expect(stored.headers.get(CACHE_STATUS_HEADER)).toBeNull();

    const second = await withEdgeCache(
      cache,
      KEY,
      "Accept",
      waitUntil,
      produce,
    );
    expect(produce).toHaveBeenCalledTimes(1);
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(second.headers.get("Vary")).toBe("Accept");
    expect(second.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(second.headers.get("Content-Type")).toBe("image/avif");
    expect(await second.text()).toBe("img");
  });

  it("does not store errors, degraded results or failed transforms", async () => {
    for (const produced of [
      { response: image({}, 404), store: true },
      { response: image({}, 502), store: true },
      {
        response: image({ "Cache-Control": "public, max-age=300" }),
        store: false,
      },
      { response: image({ "Cf-Resized": "err=9422" }), store: true },
    ]) {
      const { cache } = memoryCache();
      const waitUntil = vi.fn();
      const res = await withEdgeCache(cache, KEY, null, waitUntil, async () =>
        produced,
      );
      expect(res.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
      expect(cache.put).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
    }
  });

  it("still serves the image when the cache fails", async () => {
    const cache: EdgeCache = {
      match: vi.fn(async () => {
        throw new Error("match");
      }) as EdgeCache["match"],
      put: vi.fn(async () => {
        throw new Error("put");
      }) as EdgeCache["put"],
    };
    const pending: Promise<unknown>[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withEdgeCache(
      cache,
      KEY,
      null,
      (p) => void pending.push(p),
      async () => ({ response: image(), store: true }),
    );
    expect(res.status).toBe(200);
    await expect(Promise.all(pending)).resolves.toBeDefined();
    error.mockRestore();
  });
});
