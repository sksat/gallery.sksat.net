import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_CACHE_CONTROL,
  handleWorldImage,
  isWorldImageUrl,
  parseWorldImageUrl,
  WORLD_IMAGE_MAX_BYTES,
  type WorldImageContext,
} from "./world-image";

const ID = "8f4pau5wqb";
const IMAGE =
  "https://api.vrchat.cloud/api/1/file/file_f717cb09-03ec-4904-8072-874e0f670744/2/file";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("parseWorldImageUrl", () => {
  it("takes /img/world/<public_id> without a query", () => {
    const u = (s: string) => new URL(`https://gallery.sksat.net${s}`);
    expect(parseWorldImageUrl(u(`/img/world/${ID}`))).toBe(ID);
    expect(parseWorldImageUrl(u(`/img/world/${ID}?size=w1200`))).toEqual({
      status: 400,
    });
    expect(parseWorldImageUrl(u("/img/world/bad"))).toBeNull();
    expect(parseWorldImageUrl(u(`/img/${ID}`))).toBeNull();
    expect(parseWorldImageUrl(u(`/img/world/${ID}/x`))).toBeNull();
  });
});

describe("isWorldImageUrl", () => {
  it("is VRChat's file servers over https only", () => {
    expect(isWorldImageUrl(IMAGE)).toBe(true);
    expect(isWorldImageUrl("https://files.vrchat.cloud/a.png?sig=1")).toBe(
      true,
    );
    expect(isWorldImageUrl("https://example.com/a.png")).toBe(false);
    expect(isWorldImageUrl("http://files.vrchat.cloud/a.png")).toBe(false);
  });
});

const png = () =>
  new Response(PNG, { headers: { "Content-Type": "image/png" } });

/** VRChat's API answers with a redirect to its file server. */
const FILE = "https://files.vrchat.cloud/World-Image.png?sig=1";
const redirect = (to: string) =>
  new Response(null, { status: 302, headers: { Location: to } });

const setup = (
  image: string | null | Error,
  upstream: (url: string) => Response = (url) =>
    url === IMAGE ? redirect(FILE) : png(),
) => {
  const entries = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  const fetchFn = vi.fn(async (url: string) => upstream(url));
  const ctx: WorldImageContext = {
    worldImage: async () => {
      if (image instanceof Error) throw image;
      return image;
    },
    cache: {
      match: async (key) => entries.get(key)?.clone(),
      put: async (key, res) => void entries.set(key, res),
    },
    fetch: fetchFn as unknown as typeof fetch,
    waitUntil: (p) => void pending.push(p),
  };
  return { ctx, entries, fetchFn, settle: () => Promise.all(pending) };
};

describe("handleWorldImage", () => {
  it("passes the picture on through VRChat's redirect, and keeps it", async () => {
    const s = setup(IMAGE);
    const res = await handleWorldImage(ID, s.ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(BROWSER_CACHE_CONTROL);
    expect(res.headers.get("X-Image-Cache")).toBe("MISS");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(s.fetchFn.mock.calls.map((c) => c[0])).toEqual([IMAGE, FILE]);
    await s.settle();

    const again = await handleWorldImage(ID, s.ctx);
    expect(again.headers.get("X-Image-Cache")).toBe("HIT");
    expect(again.headers.get("Cache-Control")).toBe(BROWSER_CACHE_CONTROL);
    expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("never follows a redirect off VRChat's file servers", async () => {
    const s = setup(IMAGE, (url) =>
      url === IMAGE ? redirect("https://example.com/a.png") : png(),
    );
    expect((await handleWorldImage(ID, s.ctx)).status).toBe(502);
    expect(s.fetchFn.mock.calls.map((c) => c[0])).toEqual([IMAGE]);
    // Nor an endless chain.
    const loop = setup(IMAGE, () => redirect(FILE));
    expect((await handleWorldImage(ID, loop.ctx)).status).toBe(502);
    expect(loop.fetchFn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("stops reading a picture past its size, even without a length", async () => {
    const big = new Uint8Array(WORLD_IMAGE_MAX_BYTES + 1);
    const s = setup(
      IMAGE,
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(big);
              c.close();
            },
          }),
          { headers: { "Content-Type": "image/png" } },
        ),
    );
    expect((await handleWorldImage(ID, s.ctx)).status).toBe(502);
    expect(s.entries.size).toBe(0);
  });

  it("is 404 when the photo links no world, without fetching", async () => {
    const s = setup(null);
    expect((await handleWorldImage(ID, s.ctx)).status).toBe(404);
    const t = setup("https://example.com/evil.png");
    expect((await handleWorldImage(ID, t.ctx)).status).toBe(404);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it("is 503 when the API fails", async () => {
    const s = setup(new Error("down"));
    expect((await handleWorldImage(ID, s.ctx)).status).toBe(503);
  });

  it("passes on nothing but an image from VRChat", async () => {
    const html = setup(
      IMAGE,
      () => new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    );
    expect((await handleWorldImage(ID, html.ctx)).status).toBe(502);
    const failed = setup(IMAGE, () => new Response("no", { status: 403 }));
    expect((await handleWorldImage(ID, failed.ctx)).status).toBe(502);
    expect(html.entries.size + failed.entries.size).toBe(0);
  });
});
