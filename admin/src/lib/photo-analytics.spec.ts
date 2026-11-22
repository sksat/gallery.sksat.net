import { describe, expect, it, vi } from "vitest";
import type { SimpleCache } from "./cf-graphql";
import {
  fetchPhotoAccess,
  parsePhotoAccess,
  photoAccessQuery,
  photoPageOf,
} from "./photo-analytics";

const now = new Date("2026-11-18T03:04:05.678Z");
const ID = "aaaaaaaaa3";
const HOST = "gallery.sksat.net";

const g = (count: number, visits: number | null, dims: object = {}) => ({
  count,
  ...(visits === null ? {} : { sum: { visits } }),
  dimensions: dims,
});
const body = (node: object) => ({
  data: { viewer: { accounts: [node] } },
  errors: null,
});
const D12a = "2026-11-11T15:00:00Z";
const D12b = "2026-11-12T10:00:00Z";
const D18 = "2026-11-18T01:00:00Z";
const sample = body({
  total: [g(14, 6)],
  previous: [g(7, 3)],
  series: [
    // Hours, added up into JST days: 11/12 00:00 and 19:00 JST …
    g(4, null, { bucket: D12a, requestPath: `/photo/${ID}/` }),
    g(1, null, { bucket: D12b, requestPath: `/photo/${ID}` }),
    g(2, null, { bucket: D12b, requestPath: `/photo/${ID}/detail/` }),
    // … and 11/18 10:00 JST.
    g(6, null, { bucket: D18, requestPath: `/photo/${ID}/` }),
    g(1, null, { bucket: D18, requestPath: `/photo/${ID}/detail` }),
    // Before the window (11/11 23:00 JST): dropped.
    g(5, null, { bucket: "2026-11-11T14:00:00Z", requestPath: `/photo/${ID}/` }),
    // Not this photo's: ignored.
    g(9, null, { bucket: D18, requestPath: "/" }),
  ],
  countries: [g(10, null, { countryName: "JP" })],
  referrers: [
    g(8, null, { refererHost: HOST }),
    g(5, null, { refererHost: "" }),
    g(1, null, { refererHost: "x.com" }),
  ],
});

describe("photo paths", () => {
  it.each([
    [`/photo/${ID}`, "viewer"],
    [`/photo/${ID}/`, "viewer"],
    [`/photo/${ID}/detail`, "detail"],
    [`/photo/${ID}/detail/`, "detail"],
    [`/photo/${ID}/x`, null],
    ["/photo/aaaaaaaaa2/", null],
    ["/", null],
  ])("%s", (path, page) => expect(photoPageOf(path, ID)).toBe(page));

  it("filters on the four paths", () => {
    expect(photoAccessQuery("7d", ID)).toContain(
      `requestPath_in: ["/photo/${ID}","/photo/${ID}/","/photo/${ID}/detail","/photo/${ID}/detail/"]`,
    );
    expect(photoAccessQuery("24h", ID)).toContain(
      "dimensions { bucket: datetimeHour requestPath }",
    );
  });
});

describe("parsePhotoAccess", () => {
  it("splits the viewer and the detail page per bucket", () => {
    const s = parsePhotoAccess(sample, "7d", now, ID, HOST)!;
    expect(s.total).toEqual({ pageViews: 14, visits: 6 });
    expect(s.previous).toEqual({ pageViews: 7, visits: 3 });
    expect(s.series).toHaveLength(7);
    expect(s.series[0]).toEqual({ key: "2026-11-12", viewer: 5, detail: 2 });
    expect(s.series[1]).toEqual({ key: "2026-11-13", viewer: 0, detail: 0 });
    expect(s.series[6]).toEqual({ key: "2026-11-18", viewer: 6, detail: 1 });
    expect(s.viewer).toBe(11);
    expect(s.detail).toBe(3);
    expect(s.countries).toEqual([{ country: "JP", pageViews: 10 }]);
    // The site itself is not a referrer.
    expect(s.referrers).toEqual([
      { host: "", pageViews: 5 },
      { host: "x.com", pageViews: 1 },
    ]);
  });

  it("rejects errors and other shapes", () => {
    expect(
      parsePhotoAccess({ errors: [{ message: "x" }] }, "7d", now, ID, HOST),
    ).toBeNull();
    expect(
      parsePhotoAccess(body({ total: [] }), "7d", now, ID, HOST),
    ).toBeNull();
  });
});

describe("fetchPhotoAccess", () => {
  const config = {
    kind: "ok" as const,
    cfg: { token: "t0k", accountId: "acc", siteTag: "s", host: HOST },
  };
  const memoryCache = (): SimpleCache & { keys: string[] } => {
    const m = new Map<string, string>();
    return {
      keys: [],
      async match(k) {
        const v = m.get(k);
        return v === undefined ? undefined : new Response(v);
      },
      async put(k, res) {
        this.keys.push(k);
        m.set(k, await res.text());
      },
    };
  };

  it("asks once per photo and range, then from the cache", async () => {
    const f = vi.fn(async () => Response.json(sample));
    const cache = memoryCache();
    const deps = { fetch: f as unknown as typeof fetch, cache, now };
    const r = await fetchPhotoAccess(config, ID, "7d", deps);
    expect(r.kind).toBe("ok");
    expect(await fetchPhotoAccess(config, ID, "7d", deps)).toEqual(r);
    expect(f).toHaveBeenCalledTimes(1);
    expect(cache.keys[0]).toContain(ID);
    expect(cache.keys[0]).not.toContain("t0k");
    const sent = JSON.parse(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(sent.variables.since).toBe("2026-11-11T15:00:00Z");
    expect(sent.variables.prevUntil).toBe("2026-11-11T14:59:59Z");
  });

  it("never asks for something that is not a public id", async () => {
    const f = vi.fn();
    const deps = { fetch: f as unknown as typeof fetch, cache: null, now };
    expect(await fetchPhotoAccess(config, '"] } }', "7d", deps)).toEqual({
      kind: "error",
    });
    expect(
      await fetchPhotoAccess({ kind: "no-token" }, ID, "7d", deps),
    ).toEqual({ kind: "no-token" });
    expect(f).not.toHaveBeenCalled();
  });

  it("turns API failures into an error", async () => {
    const f = async () => new Response("denied", { status: 403 });
    expect(
      await fetchPhotoAccess(config, ID, "30d", {
        fetch: f as unknown as typeof fetch,
        cache: null,
        now,
      }),
    ).toEqual({ kind: "error" });
  });
});
