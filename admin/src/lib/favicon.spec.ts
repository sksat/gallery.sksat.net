import { describe, expect, it } from "vitest";
import {
  faviconResponse,
  fetchFavicon,
  iconHrefsOf,
  isAllowedUrl,
  MAX_ICON_BYTES,
  sniffImage,
  type FaviconDeps,
} from "./favicon";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);

type Route = Response | (() => Response);

/** A fetch that answers from `routes` by URL and records what it was asked. */
const fakeFetch = (routes: Record<string, Route>) => {
  const asked: string[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    expect(init?.redirect).toBe("manual");
    const r = routes[url];
    if (!r) return new Response("no", { status: 404 });
    return typeof r === "function" ? r() : r.clone();
  }) as typeof fetch;
  return { fn, asked };
};
const redirect = (to: string) =>
  new Response(null, { status: 302, headers: { location: to } });
const html = (s: string) =>
  new Response(s, { headers: { "content-type": "text/html" } });

describe("sniffImage", () => {
  it("knows raster images by their first bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(ICO)).toBe("image/x-icon");
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe(
      "image/gif",
    );
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImage(webp)).toBe("image/webp");
  });
  it("refuses SVG, HTML and anything else", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(enc("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
      null,
    );
    expect(sniffImage(enc("<!doctype html>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    // An ICO header with no images.
    expect(sniffImage(new Uint8Array([0, 0, 1, 0, 0, 0]))).toBeNull();
  });
});

describe("isAllowedUrl", () => {
  it.each([
    ["https://example.com/favicon.ico", true],
    ["https://example.com:443/favicon.ico", true],
    ["http://example.com/favicon.ico", false],
    ["https://example.com:8443/favicon.ico", false],
    ["https://user:pw@example.com/", false],
    ["https://127.0.0.1/", false],
    ["https://[::1]/", false],
    ["https://localhost/", false],
    ["https://169.254.169.254/latest/meta-data/", false],
    ["https://0x7f000001/", false],
    ["file:///etc/passwd", false],
    ["data:image/png;base64,AAAA", false],
  ])("%s → %s", (url, ok) => {
    expect(isAllowedUrl(new URL(url))).toBe(ok);
  });
});

describe("iconHrefsOf", () => {
  const base = new URL("https://example.com/blog/");
  const hrefs = (html: string) => iconHrefsOf(html, base).map((u) => u.href);
  it("prefers rel=icon, resolving it against the page", () => {
    expect(
      hrefs(
        `<link rel="apple-touch-icon" href="/apple.png"><link rel="shortcut icon" href='img/fav.png?v=1&amp;x=2'>`,
      ),
    ).toEqual([
      "https://example.com/blog/img/fav.png?v=1&x=2",
      "https://example.com/apple.png",
    ]);
  });
  it("takes apple-touch-icon without an icon, unquoted hrefs too", () => {
    expect(hrefs("<LINK REL=apple-touch-icon HREF=/a.png>")).toEqual([
      "https://example.com/a.png",
    ]);
  });
  it("leaves out links it may not fetch, keeping at most 3", () => {
    expect(
      hrefs(
        [
          "data:image/png;base64,AAAA",
          "http://example.com/a.png",
          "https://127.0.0.1/a.png",
          "/1.png",
          "/2.png",
          "/3.png",
          "/4.png",
        ]
          .map((h) => `<link rel="icon" href="${h}">`)
          .join(""),
      ),
    ).toEqual([
      "https://example.com/1.png",
      "https://example.com/2.png",
      "https://example.com/3.png",
    ]);
  });
  it("finds nothing without an icon link", () => {
    expect(hrefs('<link rel="stylesheet" href="/a.css">')).toEqual([]);
  });
});

describe("fetchFavicon", () => {
  const deps = (fn: typeof fetch): FaviconDeps => ({ fetch: fn });

  it("takes /favicon.ico when it is an image", async () => {
    const f = fakeFetch({
      "https://example.com/favicon.ico": new Response(ICO),
    });
    expect(await fetchFavicon("example.com", deps(f.fn))).toEqual({
      type: "image/x-icon",
      body: ICO,
    });
  });

  it("else the icon the home page links to, after its redirect", async () => {
    const f = fakeFetch({
      "https://example.com/favicon.ico": html("<html>not found</html>"),
      "https://example.com/": redirect("https://www.example.com/home/"),
      "https://www.example.com/home/": html(
        '<head><link rel="icon" href="icon.png"></head>',
      ),
      "https://www.example.com/home/icon.png": new Response(PNG),
    });
    expect(await fetchFavicon("example.com", deps(f.fn))).toEqual({
      type: "image/png",
      body: PNG,
    });
  });

  it("never follows a redirect or link to a private or plain-http place", async () => {
    for (const to of [
      "http://example.com/favicon.ico",
      "https://127.0.0.1/favicon.ico",
      "https://localhost/favicon.ico",
      "https://metadata.internal/",
      "https://example.com:8080/favicon.ico",
    ]) {
      const f = fakeFetch({
        "https://example.com/favicon.ico": redirect(to),
        "https://example.com/": html(`<link rel="icon" href="${to}">`),
      });
      expect(await fetchFavicon("example.com", deps(f.fn))).toBeNull();
      expect(f.asked).toEqual([
        "https://example.com/favicon.ico",
        "https://example.com/",
      ]);
    }
  });

  it("tries the next icon link when one fails", async () => {
    const f = fakeFetch({
      "https://example.com/": html(
        '<link rel="icon" href="/gone.png"><link rel="icon" href="/ok.png">',
      ),
      "https://example.com/ok.png": new Response(PNG),
    });
    expect((await fetchFavicon("example.com", deps(f.fn)))?.type).toBe(
      "image/png",
    );
  });

  it("stops after 3 redirects", async () => {
    const f = fakeFetch({
      "https://example.com/favicon.ico": redirect("/a"),
      "https://example.com/a": redirect("/b"),
      "https://example.com/b": redirect("/c"),
      "https://example.com/c": redirect("/d"),
      "https://example.com/d": new Response(PNG),
    });
    expect(await fetchFavicon("example.com", deps(f.fn))).toBeNull();
    expect(f.asked).not.toContain("https://example.com/d");
  });

  it("refuses an icon over the size cap, or one that is not a raster image", async () => {
    const big = new Uint8Array(MAX_ICON_BYTES + 1);
    big.set(PNG);
    for (const body of [
      big,
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    ]) {
      const f = fakeFetch({
        "https://example.com/favicon.ico": () =>
          new Response(body, { headers: { "content-type": "image/png" } }),
      });
      expect(await fetchFavicon("example.com", deps(f.fn))).toBeNull();
    }
  });

  it("asks nothing for a host that is not allowed", async () => {
    const f = fakeFetch({});
    for (const host of ["127.0.0.1", "localhost", "a.internal", "x.nip.io"]) {
      expect(await fetchFavicon(host, deps(f.fn))).toBeNull();
    }
    expect(f.asked).toEqual([]);
  });

  it("gives up after its time limit", async () => {
    const slow = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal!.reason),
        ),
      )) as typeof fetch;
    expect(
      await fetchFavicon("example.com", { fetch: slow, timeoutMs: 20 }),
    ).toBeNull();
  });

  it("asks the E2E target instead when given one", async () => {
    const f = fakeFetch({
      "http://127.0.0.1:9/example.com/favicon.ico": new Response(PNG),
    });
    const icon = await fetchFavicon("example.com", {
      fetch: f.fn,
      target: (u) => `http://127.0.0.1:9/${u.hostname}${u.pathname}`,
    });
    expect(icon?.type).toBe("image/png");
  });
});

describe("faviconResponse", () => {
  const memCache = () => {
    const m = new Map<string, Response>();
    return {
      m,
      match: async (k: string) => m.get(k)?.clone(),
      put: async (k: string, r: Response) => void m.set(k, r),
    };
  };

  it("400s a host that is not allowed, asking nothing", async () => {
    const f = fakeFetch({});
    const res = await faviconResponse("127.0.0.1", {
      fetch: f.fn,
      cache: null,
      key: "k",
    });
    expect(res.status).toBe(400);
    expect(f.asked).toEqual([]);
  });

  it("answers the favicon and keeps it", async () => {
    const f = fakeFetch({
      "https://example.com/favicon.ico": new Response(PNG),
    });
    const cache = memCache();
    const res = await faviconResponse("example.com", {
      fetch: f.fn,
      cache,
      key: "k",
    });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(cache.m.get("k")?.headers.get("cache-control")).toBe(
      "max-age=604800",
    );
    // Again: from the cache, nothing asked.
    const again = await faviconResponse("example.com", {
      fetch: fakeFetch({}).fn,
      cache,
      key: "k",
    });
    expect(again.headers.get("x-favicon")).toBe("found");
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG);
  });

  it("answers our globe when there is none, kept an hour", async () => {
    const cache = memCache();
    const res = await faviconResponse("example.com", {
      fetch: fakeFetch({}).fn,
      cache,
      key: "k",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toContain("<circle");
    expect(cache.m.get("k")?.headers.get("cache-control")).toBe("max-age=3600");
  });
});
