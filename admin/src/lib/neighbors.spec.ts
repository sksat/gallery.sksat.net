import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  neighborLinks,
  neighborsQuery,
  parseListHref,
  type ListQuery,
  type NeighborRow,
} from "./neighbors";

const list = (over: Partial<ListQuery> = {}): ListQuery => ({
  view: "list",
  dir: "/",
  world: null,
  visibility: null,
  q: "",
  page: 1,
  ...over,
});

describe("parseListHref", () => {
  it("reads the view, folder, filter and page", () => {
    expect(
      parseListHref(
        "/media/?view=files&dir=/a/b&world=VRChat&q=x&visibility=private",
      ),
    ).toEqual(
      list({
        view: "files",
        dir: "/a/b",
        world: "VRChat",
        visibility: "private",
        q: "x",
      }),
    );
    expect(parseListHref("/media/?page=3")).toEqual(list({ page: 3 }));
  });

  it("ignores bad values", () => {
    expect(
      parseListHref("/media/?world=Moon&visibility=x&page=-1&dir=/../a"),
    ).toEqual(list());
    expect(parseListHref("/media/")).toEqual(list());
  });
});

// The real query against SQLite: window functions and the folder match.
const db = (extra: [number, string][]) => {
  const d = new DatabaseSync(":memory:");
  d.exec(
    "CREATE TABLE media (id INTEGER PRIMARY KEY, file TEXT, world TEXT, visibility TEXT, timestamp TEXT, status TEXT NOT NULL DEFAULT 'ready')",
  );
  // Still uploading: in no list.
  d.exec(
    "INSERT INTO media (id, file, world, visibility, timestamp, status) VALUES (90, '/a/0.png', 'Real', 'public', '2023-12-02', 'uploading')",
  );
  const insert = d.prepare(
    "INSERT INTO media (id, file, world, visibility, timestamp) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(1, "/a/2.png", "Real", "public", "2023-12-01");
  insert.run(2, "/a/1.png", "VRChat", "private", "2023-12-03");
  insert.run(3, "/a/b/3.png", "VRChat", "public", "2023-12-02");
  insert.run(4, "/top.png", "Real", "public", null);
  insert.run(5, "/a/3.png", "VRChat", "public", "2023-12-03");
  for (const [id, file] of extra) {
    insert.run(id, file, "Real", "public", "2023-11-01");
  }
  return d;
};

const run = (q: ListQuery, id: number, extra: [number, string][] = []) => {
  const { sql, args } = neighborsQuery(q, id);
  const row = db(extra)
    .prepare(sql)
    .get(...(args as (string | number)[])) as NeighborRow | undefined;
  if (!row) return row;
  // The files are checked on their own below.
  const { prev_id, next_id, pos, total } = row;
  return { prev_id, next_id, pos, total };
};

describe("neighborsQuery files", () => {
  it("returns the neighbours' files too", () => {
    const { sql, args } = neighborsQuery(list(), 3);
    expect(
      db([])
        .prepare(sql)
        .get(...(args as (string | number)[])),
    ).toMatchObject({ prev_file: "/a/1.png", next_file: "/a/2.png" });
  });
});

describe("neighborsQuery", () => {
  it("follows the list order (date desc, then id desc, undated last)", () => {
    // Order: 5, 2 (same date, id desc), 3, 1, 4 (no date).
    expect(run(list(), 5)).toEqual({
      prev_id: null,
      next_id: 2,
      pos: 1,
      total: 5,
    });
    expect(run(list(), 3)).toEqual({
      prev_id: 2,
      next_id: 1,
      pos: 3,
      total: 5,
    });
    expect(run(list(), 4)).toEqual({
      prev_id: 1,
      next_id: null,
      pos: 5,
      total: 5,
    });
  });

  it("applies the filter", () => {
    expect(run(list({ world: "VRChat", visibility: "public" }), 5)).toEqual({
      prev_id: null,
      next_id: 3,
      pos: 1,
      total: 2,
    });
    // No longer in the filtered list (VRChat): it still gets neighbours,
    // so the next photo is one tap away. Order: 2, 1, 4.
    expect(run(list({ world: "Real" }), 2)).toEqual({
      prev_id: null,
      next_id: 1,
      pos: 1,
      total: 3,
    });
    expect(run(list(), 99)).toBeUndefined();
  });

  it("walks one folder by name in the files view", () => {
    const a = list({ view: "files", dir: "/a" });
    // /a/1.png (2), /a/2.png (1), /a/3.png (5); not /a/b/3.png.
    expect(run(a, 1)).toEqual({ prev_id: 2, next_id: 5, pos: 2, total: 3 });
    // Opened from /a but in /a/b: still walks from where it sorts.
    expect(run(a, 3)).toEqual({ prev_id: 5, next_id: null, pos: 4, total: 4 });
    // Folder names outside the BMP (SQLite counts characters).
    expect(
      run(list({ view: "files", dir: "/😀" }), 7, [
        [6, "/😀/a.png"],
        [7, "/😀/b.png"],
      ]),
    ).toEqual({ prev_id: 6, next_id: null, pos: 2, total: 2 });
    expect(run(list({ view: "files", dir: "/" }), 4)).toEqual({
      prev_id: null,
      next_id: null,
      pos: 1,
      total: 1,
    });
  });
});

describe("neighborLinks", () => {
  const row: NeighborRow = { prev_id: 7, next_id: 9, pos: 100, total: 150 };

  it("points each neighbour's back link at the page it is on", () => {
    expect(neighborLinks(list({ q: "x" }), row, 100)).toEqual({
      prev: "/media/7/?back=%2Fmedia%2F%3Fq%3Dx",
      next: "/media/9/?back=%2Fmedia%2F%3Fq%3Dx%26page%3D2",
      prevFile: null,
      nextFile: null,
      pos: 100,
      total: 150,
    });
  });

  it("keeps the folder in the files view and has no link at an end", () => {
    expect(
      neighborLinks(
        list({ view: "files", dir: "/a" }),
        {
          prev_id: null,
          next_id: 2,
          prev_file: null,
          next_file: "/a/2.png",
          pos: 1,
          total: 2,
        },
        100,
      ),
    ).toEqual({
      prev: null,
      next: "/media/2/?back=%2Fmedia%2F%3Fview%3Dfiles%26dir%3D%2Fa",
      prevFile: null,
      nextFile: "/a/2.png",
      pos: 1,
      total: 2,
    });
  });
});
