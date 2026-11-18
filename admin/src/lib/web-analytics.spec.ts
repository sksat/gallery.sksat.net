import { describe, expect, it, vi } from "vitest";
import { GRAPHQL_ENDPOINT, type SimpleCache } from "./cf-graphql";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import {
  bucketKeys,
  countryLabel,
  fetchAccess,
  getWebAnalyticsConfig,
  parseAccess,
  parseAccessRange,
  parsePhotoPath,
  photoCounts,
  photoIdsOf,
  photoRowsFor,
  rangeWindow,
  referrerLabel,
  topPhotos,
  type PhotoMediaRow,
} from "./web-analytics";

const now = new Date("2026-11-18T03:04:05.678Z");

describe("ranges", () => {
  it("parses the query value", () => {
    expect(parseAccessRange("24h")).toBe("24h");
    expect(parseAccessRange("30d")).toBe("30d");
    expect(parseAccessRange("1y")).toBe("7d");
    expect(parseAccessRange(null)).toBe("7d");
  });

  it("covers 24 whole hours, or whole UTC days up to now", () => {
    expect(rangeWindow("24h", now)).toEqual({
      since: "2026-11-17T04:00:00Z",
      until: "2026-11-18T03:04:05Z",
    });
    expect(rangeWindow("7d", now).since).toBe("2026-11-12T00:00:00Z");
    expect(rangeWindow("30d", now).since).toBe("2026-10-20T00:00:00Z");
  });

  it("lists the buckets oldest first", () => {
    const h = bucketKeys("24h", now);
    expect(h).toHaveLength(24);
    expect(h[0]).toBe("2026-11-17T04");
    expect(h[23]).toBe("2026-11-18T03");
    expect(bucketKeys("7d", now)).toEqual([
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]);
    expect(bucketKeys("30d", now)).toHaveLength(30);
  });
});

const g = (count: number, visits: number | null, dims: object = {}) => ({
  count,
  ...(visits === null ? {} : { sum: { visits } }),
  dimensions: dims,
});
const body = (node: object) => ({
  data: { viewer: { accounts: [node] } },
  errors: null,
});
const sample = body({
  total: [g(30, 12)],
  series: [
    g(10, 4, { bucket: "2026-11-12" }),
    g(20, 8, { bucket: "2026-11-18T00:00:00Z" }),
  ],
  pages: [
    g(9, 5, { requestPath: "/" }),
    g(6, 3, { requestPath: "/photo/aaaaaaaaa3/" }),
    g(2, 1, { requestPath: "/photo/aaaaaaaaa3" }),
    g(1, 1, { requestPath: "/photo/aaaaaaaaa2/" }),
    // An old numeric URL: listed as a page, never attributed to a photo.
    g(1, 0, { requestPath: "/photo/1" }),
  ],
  countries: [
    g(25, null, { countryName: "JP" }),
    g(5, null, { countryName: "US" }),
  ],
  referrers: [
    g(20, null, { refererHost: "" }),
    g(7, null, { refererHost: "admin.gallery.sksat.net" }),
    g(4, null, { refererHost: "gallery.sksat.net" }),
    g(3, null, { refererHost: "x.com" }),
    g(1, null, { refererHost: "sksat.cloudflareaccess.com" }),
  ],
});
const HOST = "gallery.sksat.net";

describe("parseAccess", () => {
  it("reads the groups and fills empty buckets with zeros", () => {
    const s = parseAccess(sample, "7d", now, HOST)!;
    expect(s.total).toEqual({ pageViews: 30, visits: 12 });
    expect(s.series.map((b) => [b.key, b.pageViews, b.visits])).toEqual([
      ["2026-11-12", 10, 4],
      ["2026-11-13", 0, 0],
      ["2026-11-14", 0, 0],
      ["2026-11-15", 0, 0],
      ["2026-11-16", 0, 0],
      ["2026-11-17", 0, 0],
      ["2026-11-18", 20, 8],
    ]);
    expect(s.pages[1]).toEqual({
      path: "/photo/aaaaaaaaa3/",
      pageViews: 6,
      visits: 3,
    });
    expect(s.countries).toEqual([
      { country: "JP", pageViews: 25 },
      { country: "US", pageViews: 5 },
    ]);
    // The site's own hosts and the Access login are not referrers.
    expect(s.referrers).toEqual([
      { host: "", pageViews: 20 },
      { host: "x.com", pageViews: 3 },
    ]);
  });

  it("reads no traffic as zeros", () => {
    const s = parseAccess(
      body({ total: [], series: [], pages: [], countries: [], referrers: [] }),
      "24h",
      now,
      HOST,
    )!;
    expect(s.total).toEqual({ pageViews: 0, visits: 0 });
    expect(s.series).toHaveLength(24);
    expect(s.series.every((b) => b.pageViews === 0)).toBe(true);
  });

  it("rejects errors and other shapes", () => {
    expect(
      parseAccess({ data: null, errors: [{ message: "x" }] }, "7d", now, HOST),
    ).toBeNull();
    expect(parseAccess(body({ total: [] }), "7d", now, HOST)).toBeNull();
    expect(
      parseAccess(
        body({
          total: [g(1, 1)],
          series: [],
          pages: [{ count: "1", dimensions: { requestPath: "/" } }],
          countries: [],
          referrers: [],
        }),
        "7d",
        now,
        HOST,
      ),
    ).toBeNull();
  });
});

const memoryCache = (): SimpleCache & { keys: string[] } => {
  const m = new Map<string, string>();
  return {
    keys: [] as string[],
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

describe("fetchAccess", () => {
  const config = {
    kind: "ok" as const,
    cfg: { token: "t0k", accountId: "acc", siteTag: "site1", host: HOST },
  };

  it("passes on a missing token or site tag without fetching", async () => {
    const f = vi.fn();
    const deps = { fetch: f as unknown as typeof fetch, cache: null, now };
    expect(await fetchAccess({ kind: "no-token" }, "7d", deps)).toEqual({
      kind: "no-token",
    });
    expect(await fetchAccess({ kind: "no-site-tag" }, "7d", deps)).toEqual({
      kind: "no-site-tag",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("queries by site tag and window, then serves from the cache", async () => {
    const f = vi.fn(async () => Response.json(sample));
    const cache = memoryCache();
    const deps = { fetch: f as unknown as typeof fetch, cache, now };
    const r = await fetchAccess(config, "7d", deps);
    expect(r.kind).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GRAPHQL_ENDPOINT);
    const sent = JSON.parse(init.body as string);
    expect(sent.variables).toEqual({
      accountTag: "acc",
      siteTag: "site1",
      host: HOST,
      since: "2026-11-12T00:00:00Z",
      until: "2026-11-18T03:04:05Z",
    });
    expect(sent.query).toContain("dimensions { bucket: date }");
    expect(sent.query).toContain("requestHost: $host");
    expect(cache.keys[0]).not.toContain("t0k");
    expect(await fetchAccess(config, "7d", deps)).toEqual(r);
    expect(f).toHaveBeenCalledTimes(1);
    // Another range is another request.
    await fetchAccess(config, "24h", deps);
    expect(f).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        (f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
      ).query,
    ).toContain("bucket: datetimeHour");
  });

  it("turns API failures into an error", async () => {
    const f = async () => new Response("denied", { status: 403 });
    expect(
      await fetchAccess(config, "30d", {
        fetch: f as unknown as typeof fetch,
        cache: null,
        now,
      }),
    ).toEqual({ kind: "error" });
  });
});

describe("getWebAnalyticsConfig", () => {
  const env = {
    CF_ANALYTICS_API_TOKEN: "t",
    CF_ACCOUNT_ID: "a",
    WEB_ANALYTICS_SITE_TAG: "s",
    WEB_ANALYTICS_HOST: "h",
  };
  it("needs the token, the account, the site tag and host", () => {
    expect(getWebAnalyticsConfig({ env })).toEqual({
      kind: "ok",
      cfg: { token: "t", accountId: "a", siteTag: "s", host: "h" },
    });
    expect(
      getWebAnalyticsConfig({ env: { ...env, WEB_ANALYTICS_SITE_TAG: "" } }),
    ).toEqual({ kind: "no-site-tag" });
    expect(
      getWebAnalyticsConfig({ env: { ...env, WEB_ANALYTICS_HOST: "" } }),
    ).toEqual({ kind: "no-site-tag" });
    expect(getWebAnalyticsConfig({ env: {} })).toEqual({ kind: "no-token" });
  });
});

describe("photo paths", () => {
  it.each([
    ["/photo/aaaaaaaaa3/", "aaaaaaaaa3"],
    ["/photo/aaaaaaaaa3", "aaaaaaaaa3"],
    ["/photo/12/", null],
    ["/photo/0", null],
    ["/photo/", null],
    ["/photo/AAAAAAAAA3/", null],
    ["/photo/aaaaaaaaa3/x", null],
    ["/camera/x/", null],
  ])("%s", (path, id) => expect(parsePhotoPath(path)).toBe(id));

  const rows: PhotoMediaRow[] = [
    {
      id: 1,
      public_id: "aaaaaaaaa2",
      file: "/mock/real1.png",
      platform: "Real",
    },
    {
      id: 2,
      public_id: "aaaaaaaaa3",
      file: "/mock/vrchat1.png",
      platform: "VRChat",
    },
  ];
  const pages = parseAccess(sample, "7d", now, HOST)!.pages;

  it("collects the public ids to look up", () => {
    expect(photoIdsOf(pages)).toEqual(["aaaaaaaaa3", "aaaaaaaaa2"]);
  });

  it("adds a photo's paths with and without the slash together", () => {
    expect(photoCounts(pages, "aaaaaaaaa3")).toEqual({
      pageViews: 8,
      visits: 4,
    });
    expect(photoCounts(pages, "aaaaaaaaa2")).toEqual({
      pageViews: 1,
      visits: 1,
    });
    expect(photoCounts(pages, "zzzzzzzzzz")).toEqual({
      pageViews: 0,
      visits: 0,
    });
  });

  it("ranks photos by page views", () => {
    expect(
      topPhotos(pages, rows).map((p) => [p.row.id, p.pageViews, p.visits]),
    ).toEqual([
      [2, 8, 4],
      [1, 1, 1],
    ]);
    expect(topPhotos(pages, rows, 1)).toHaveLength(1);
  });

  it("finds the rows on the real schema, ready ones only", async () => {
    const db = migratedSqlite();
    db.exec(`INSERT INTO media (file, platform, public_id) VALUES
        ('/a.png', 'Real', 'aaaaaaaaa2'),
        ('/b.png', 'Real', 'aaaaaaaaa3');
      INSERT INTO media (file, platform, public_id, status) VALUES
        ('/c.png', 'Real', 'aaaaaaaaa4', 'uploading');`);
    const found = await photoRowsFor(sqliteD1(db), [
      "aaaaaaaaa3",
      "aaaaaaaaa4",
    ]);
    expect(found.map((r) => r.file)).toEqual(["/b.png"]);
  });

  it("looks up more ids than D1 binds in one query", async () => {
    const db = migratedSqlite();
    db.exec(`INSERT INTO media (file, platform, public_id) VALUES
        ('/a.png', 'Real', 'aaaaaaaaa2');`);
    const ids = Array.from({ length: 200 }, (_, i) => `none-${i}`);
    const found = await photoRowsFor(sqliteD1(db), [...ids, "aaaaaaaaa2"]);
    expect(found.map((r) => r.file)).toEqual(["/a.png"]);
  });

  it("labels a direct visit", () => {
    expect(referrerLabel("")).toBe("(直接)");
    expect(referrerLabel("x.com")).toBe("x.com");
  });

  it("names countries in Japanese, else keeps the code", () => {
    expect(countryLabel("JP")).toBe("日本");
    expect(countryLabel("US")).toBe("アメリカ合衆国");
    expect(countryLabel("")).toBe("(不明)");
    expect(countryLabel("xx")).toBe("xx");
  });
});
