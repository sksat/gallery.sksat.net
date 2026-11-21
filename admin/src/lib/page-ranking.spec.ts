import { describe, expect, it } from "vitest";
import {
  classifyPath,
  lookupsOf,
  pageLabel,
  rankPaths,
  rankingCameras,
  rankingPhotos,
  resolveRanking,
  type RankingPhoto,
} from "./page-ranking";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

describe("classifyPath", () => {
  it.each([
    ["/", { kind: "top" }],
    ["/photo/aaaaaaaaa3/", { kind: "photo", publicId: "aaaaaaaaa3" }],
    ["/photo/aaaaaaaaa3", { kind: "photo", publicId: "aaaaaaaaa3" }],
    ["/photo/1", { kind: "old-photo" }],
    ["/photo/30/", { kind: "old-photo" }],
    ["/photo/AAAAAAAAA3/", { kind: "other" }],
    ["/photo/aaaaaaaaa3/x/", { kind: "other" }],
    ["/photo/aaaaaaaaa3/detail/", { kind: "photo", publicId: "aaaaaaaaa3" }],
    ["/photo/aaaaaaaaa3/detail", { kind: "photo", publicId: "aaaaaaaaa3" }],
    ["/photo/1/detail/", { kind: "other" }],
    ["/photo/aaaaaaaaa3/detail/x/", { kind: "other" }],
    ["/photo/", { kind: "other" }],
    ["/camera/", { kind: "cameras" }],
    ["/camera", { kind: "cameras" }],
    ["/camera/pentax-sp/", { kind: "camera", slug: "pentax-sp" }],
    ["/camera/Bad_Slug/", { kind: "other" }],
    ["/calendar/", { kind: "calendar" }],
    ["/calendar/2026/", { kind: "calendar", year: 2026 }],
    ["/calendar/2026/11/", { kind: "calendar", year: 2026, month: 11 }],
    ["/calendar/2026/13/", { kind: "other" }],
    ["/calendar/2026/1/", { kind: "other" }],
    ["/calendar/26/", { kind: "other" }],
    ["/map/", { kind: "map" }],
    ["/map/x/", { kind: "other" }],
    ["/robots.txt", { kind: "other" }],
  ])("%s", (path, kind) => expect(classifyPath(path)).toEqual(kind));
});

describe("pageLabel", () => {
  const cameras = new Map([["pentax-sp", "PENTAX SP"]]);
  it.each([
    ["/", "トップ"],
    ["/camera/", "カメラ"],
    ["/camera/pentax-sp/", "PENTAX SP"],
    ["/camera/gone/", null],
    ["/calendar/", "カレンダー"],
    ["/calendar/2026/", "2026年"],
    ["/calendar/2026/01/", "2026年1月"],
    ["/map/", "地図"],
    ["/photo/aaaaaaaaa3/", null],
    ["/x", null],
  ])("%s", (path, label) =>
    expect(pageLabel(classifyPath(path), cameras)).toBe(label),
  );
});

const page = (path: string, pageViews: number, visits = pageViews) => ({
  path,
  pageViews,
  visits,
});

describe("rankPaths", () => {
  it("adds up the forms of a page and ranks by page views", () => {
    const ranked = rankPaths(
      [
        page("/", 45),
        page("/photo/aaaaaaaaa3", 4, 2),
        page("/photo/aaaaaaaaa3/", 4, 3),
        // The photo's detail page counts for the photo.
        page("/photo/aaaaaaaaa3/detail/", 3, 2),
        page("/photo/aaaaaaaaa3/detail", 1, 1),
        page("/camera/pentax-sp/", 7),
        page("/camera/pentax-sp", 1),
        page("/map/", 8),
      ],
      10,
    );
    expect(ranked.map((r) => [r.path, r.pageViews, r.visits])).toEqual([
      ["/", 45, 45],
      ["/photo/aaaaaaaaa3/", 12, 8],
      ["/camera/pentax-sp/", 8, 8],
      ["/map/", 8, 8],
    ]);
  });

  it("puts all old numeric URLs into one entry after the top pages", () => {
    const ranked = rankPaths(
      [
        page("/", 45),
        page("/photo/1", 5),
        page("/photo/0", 3),
        page("/photo/30/", 3),
        page("/map/", 2),
        page("/camera/", 1),
      ],
      2,
    );
    expect(ranked.map((r) => [r.page.kind, r.pageViews])).toEqual([
      ["top", 45],
      ["map", 2],
      ["old-photo", 11],
    ]);
  });

  it("collects the photos and cameras to look up", () => {
    const ranked = rankPaths(
      [
        page("/photo/aaaaaaaaa3/", 3),
        page("/photo/aaaaaaaaa3", 1),
        page("/camera/pentax-sp/", 2),
        page("/photo/1", 1),
      ],
      10,
    );
    expect(lookupsOf(ranked)).toEqual({
      publicIds: ["aaaaaaaaa3"],
      slugs: ["pentax-sp"],
    });
  });
});

describe("resolveRanking", () => {
  const photo: RankingPhoto = {
    id: 2,
    public_id: "aaaaaaaaa3",
    file: "/mock/vrchat1.png",
    path: "/VRChat/vrchat1.png",
    platform: "VRChat",
    visibility: "public",
  };
  it("names each row and links it", () => {
    const ranked = rankPaths(
      [
        page("/", 10),
        page("/photo/aaaaaaaaa3/", 9),
        page("/photo/zzzzzzzzzz/", 8),
        page("/camera/pentax-sp/", 7),
        page("/camera/unknown/", 6),
        page("/photo/1", 1),
      ],
      10,
    );
    expect(
      resolveRanking(
        ranked,
        [photo],
        [{ slug: "pentax-sp", name: "PENTAX SP" }],
      ),
    ).toEqual([
      {
        kind: "page",
        page: "top",
        label: "トップ",
        href: "https://gallery.sksat.net/",
        pageViews: 10,
        visits: 10,
      },
      {
        kind: "photo",
        photo,
        href: "https://gallery.sksat.net/photo/aaaaaaaaa3/",
        pageViews: 9,
        visits: 9,
      },
      {
        kind: "gone",
        path: "/photo/zzzzzzzzzz/",
        pageViews: 8,
        visits: 8,
      },
      {
        kind: "page",
        page: "camera",
        label: "PENTAX SP",
        href: "https://gallery.sksat.net/camera/pentax-sp/",
        pageViews: 7,
        visits: 7,
      },
      {
        kind: "page",
        page: "camera",
        label: "/camera/unknown/",
        href: "https://gallery.sksat.net/camera/unknown/",
        pageViews: 6,
        visits: 6,
      },
      { kind: "old", pageViews: 1, visits: 1 },
    ]);
  });
});

describe("resolveRanking without the photo lookup", () => {
  it("keeps photo pages as links by their path", () => {
    const ranked = rankPaths([page("/photo/aaaaaaaaa3", 2)], 10);
    expect(resolveRanking(ranked, null, [])).toEqual([
      {
        kind: "page",
        page: "photo",
        label: "/photo/aaaaaaaaa3/",
        href: "https://gallery.sksat.net/photo/aaaaaaaaa3/",
        pageViews: 2,
        visits: 2,
      },
    ]);
  });
});

describe("lookups on the real schema", () => {
  it("finds listed photos only, and cameras by slug", async () => {
    const db = migratedSqlite();
    db.exec(`INSERT INTO media (file, platform, public_id) VALUES
        ('/a.png', 'Real', 'aaaaaaaaa2'),
        ('/b.png', 'Real', 'aaaaaaaaa3');
      INSERT INTO media (file, platform, public_id, status) VALUES
        ('/c.png', 'Real', 'aaaaaaaaa4', 'uploading');
      INSERT INTO media (file, platform, public_id, trashed_at) VALUES
        ('/d.png', 'Real', 'aaaaaaaaa5', '2026-01-01T00:00:00Z');
      INSERT INTO camera (slug, name) VALUES ('pentax-sp', 'PENTAX SP');`);
    const d1 = sqliteD1(db);
    const found = await rankingPhotos(d1, [
      "aaaaaaaaa3",
      "aaaaaaaaa4",
      "aaaaaaaaa5",
    ]);
    expect(found).toEqual([
      {
        id: 2,
        public_id: "aaaaaaaaa3",
        file: "/b.png",
        path: "/b.png",
        platform: "Real",
        visibility: "private",
      },
    ]);
    expect(await rankingCameras(d1, ["pentax-sp", "x"])).toEqual([
      { slug: "pentax-sp", name: "PENTAX SP" },
    ]);
    expect(await rankingPhotos(d1, [])).toEqual([]);
    expect(await rankingCameras(d1, [])).toEqual([]);
  });
});
