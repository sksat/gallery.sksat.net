import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  neighborLinks,
  neighborsStatements,
  parseListHref,
  queryNeighbors,
  type ListQuery,
  type NeighborAnchor,
  type NeighborRow,
} from "./neighbors";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { LIVE_PHOTO } from "./types";

const list = (over: Partial<ListQuery> = {}): ListQuery => ({
  view: "list",
  dir: "/",
  platform: null,
  visibility: null,
  q: "",
  date: null,
  page: 1,
  ...over,
});

describe("parseListHref", () => {
  it("reads the view, folder, filter and page", () => {
    expect(
      parseListHref(
        "/media/?view=files&dir=/a/b&platform=VRChat&q=x&visibility=private",
      ),
    ).toEqual(
      list({
        view: "files",
        dir: "/a/b",
        platform: "VRChat",
        visibility: "private",
        q: "x",
      }),
    );
    expect(parseListHref("/media/?page=3")).toEqual(list({ page: 3 }));
  });

  it("ignores bad values", () => {
    expect(
      parseListHref("/media/?platform=M%20oon&visibility=x&page=-1&dir=/../a"),
    ).toEqual(list());
    expect(parseListHref("/media/")).toEqual(list());
  });
});

// The real queries against SQLite with the D1 migrations applied.
const db = (extra: [number, string][]) => {
  const d = migratedSqlite();
  // In the trash: in no list.
  d.exec(
    "INSERT INTO media (id, file, platform, visibility, timestamp, trashed_at) VALUES (91, '/a/00.png', 'Real', 'public', '2023-12-02', '2026-01-01')",
  );
  // Still uploading: in no list.
  d.exec(
    "INSERT INTO media (id, file, platform, visibility, timestamp, status) VALUES (90, '/a/0.png', 'Real', 'public', '2023-12-02', 'uploading')",
  );
  const insert = d.prepare(
    "INSERT INTO media (id, file, platform, visibility, timestamp) VALUES (?, ?, ?, ?, ?)",
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

const anchorOf = (d: DatabaseSync, id: number) =>
  d
    .prepare("SELECT id, path, timestamp FROM media WHERE id = ?")
    .get(id) as NeighborAnchor;

const neighbours = async (d: DatabaseSync, q: ListQuery, id: number) =>
  queryNeighbors(sqliteD1(d), q, anchorOf(d, id));

const run = async (
  q: ListQuery,
  id: number,
  extra: [number, string][] = [],
) => {
  // The files are checked on their own below.
  const { prev_id, next_id, pos, total } = await neighbours(db(extra), q, id);
  return { prev_id, next_id, pos, total };
};

describe("queryNeighbors files", () => {
  it("returns the neighbours' files too", async () => {
    expect(await neighbours(db([]), list(), 3)).toMatchObject({
      prev_file: "/a/1.png",
      next_file: "/a/2.png",
    });
  });
});

describe("queryNeighbors", () => {
  it("follows the list order (date desc, then id desc, undated last)", async () => {
    // Order: 5, 2 (same date, id desc), 3, 1, 4 (no date).
    expect(await run(list(), 5)).toEqual({
      prev_id: null,
      next_id: 2,
      pos: 1,
      total: 5,
    });
    expect(await run(list(), 3)).toEqual({
      prev_id: 2,
      next_id: 1,
      pos: 3,
      total: 5,
    });
    expect(await run(list(), 1)).toEqual({
      prev_id: 3,
      next_id: 4,
      pos: 4,
      total: 5,
    });
    expect(await run(list(), 4)).toEqual({
      prev_id: 1,
      next_id: null,
      pos: 5,
      total: 5,
    });
  });

  it("applies the filter", async () => {
    expect(
      await run(list({ platform: "VRChat", visibility: "public" }), 5),
    ).toEqual({
      prev_id: null,
      next_id: 3,
      pos: 1,
      total: 2,
    });
    // No longer in the filtered list (VRChat): it still gets neighbours,
    // so the next photo is one tap away. Order: 2, 1, 4.
    expect(await run(list({ platform: "Real" }), 2)).toEqual({
      prev_id: null,
      next_id: 1,
      pos: 1,
      total: 3,
    });
  });

  it("walks a folder by where photos are shown, not their files", async () => {
    const d = db([]);
    // Photo 5's file stays /a/3.png; it is shown in /z now.
    d.exec("UPDATE media SET path = '/z/3.png' WHERE id = 5");
    expect(await neighbours(d, list({ view: "files", dir: "/z" }), 5)).toEqual({
      prev_id: null,
      next_id: null,
      prev_file: null,
      next_file: null,
      pos: 1,
      total: 1,
    });
  });

  it("walks one folder by name in the files view", async () => {
    const a = list({ view: "files", dir: "/a" });
    // /a/1.png (2), /a/2.png (1), /a/3.png (5); not /a/b/3.png.
    expect(await run(a, 1)).toEqual({
      prev_id: 2,
      next_id: 5,
      pos: 2,
      total: 3,
    });
    // Opened from /a but in /a/b: still walks from where it sorts.
    expect(await run(a, 3)).toEqual({
      prev_id: 5,
      next_id: null,
      pos: 4,
      total: 4,
    });
    // Folder names outside the BMP (SQLite counts characters).
    expect(
      await run(list({ view: "files", dir: "/😀" }), 7, [
        [6, "/😀/a.png"],
        [7, "/😀/b.png"],
      ]),
    ).toEqual({ prev_id: 6, next_id: null, pos: 2, total: 2 });
    expect(await run(list({ view: "files", dir: "/" }), 4)).toEqual({
      prev_id: null,
      next_id: null,
      pos: 1,
      total: 1,
    });
  });

  it("does not take a sibling folder sharing the name as a prefix", async () => {
    const d = db([
      [6, "/a-b/x.png"],
      [7, "/a0/x.png"],
      [8, "/ab/x.png"],
    ]);
    expect(
      await neighbours(d, list({ view: "files", dir: "/a" }), 1),
    ).toMatchObject({ prev_id: 2, next_id: 5, pos: 2, total: 3 });
  });
});

// The window query this replaced, as the reference for the order.
const windowReference = (
  d: DatabaseSync,
  q: ListQuery,
  id: number,
): NeighborRow => {
  const where = [LIVE_PHOTO];
  const args: (string | number)[] = [];
  if (q.platform) {
    where.push("platform = ?");
    args.push(q.platform);
  }
  if (q.visibility) {
    where.push("visibility = ?");
    args.push(q.visibility);
  }
  if (q.view === "files") {
    const prefix = q.dir === "/" ? "/" : `${q.dir}/`;
    where.push(
      "substr(path, 1, length(?)) = ?",
      "instr(substr(path, length(?) + 1), '/') = 0",
    );
    args.push(prefix, prefix, prefix);
  }
  const order =
    q.view === "files" ? "path" : "timestamp IS NULL, timestamp DESC, id DESC";
  return d
    .prepare(
      `SELECT prev_id, next_id, prev_file, next_file, pos, total FROM (SELECT id,` +
        ` LAG(id) OVER w AS prev_id, LEAD(id) OVER w AS next_id,` +
        ` LAG(file) OVER w AS prev_file, LEAD(file) OVER w AS next_file,` +
        ` ROW_NUMBER() OVER w AS pos, COUNT(*) OVER () AS total` +
        ` FROM media WHERE (${where.join(" AND ")}) OR id = ?` +
        ` WINDOW w AS (ORDER BY ${order})) WHERE id = ?`,
    )
    .get(...args, id, id) as NeighborRow;
};

describe("queryNeighbors against the window query", () => {
  // Ties on the date, undated photos, both platforms and levels, folders.
  const d = migratedSqlite();
  const insert = d.prepare(
    "INSERT INTO media (id, file, platform, visibility, timestamp, status, trashed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (let i = 1; i <= 60; i++) {
    insert.run(
      i,
      `/${["a", "b", "a/c"][i % 3]}/${String((i * 37) % 61).padStart(2, "0")}.png`,
      i % 2 ? "Real" : "VRChat",
      ["private", "unlisted", "public"][i % 3],
      i % 7 === 0 ? null : `2024-01-${String((i % 9) + 1).padStart(2, "0")}`,
      i % 23 === 0 ? "uploading" : "ready",
      i % 19 === 0 ? "2026-01-01" : null,
    );
  }
  const lists = [
    list(),
    list({ visibility: "public" }),
    list({ platform: "VRChat", visibility: "private" }),
    list({ view: "files", dir: "/a" }),
    list({ view: "files", dir: "/a/c", platform: "Real" }),
    list({ view: "files", dir: "/" }),
  ];
  it.each(lists.map((q) => [JSON.stringify(q), q] as const))(
    "%s",
    async (_, q) => {
      for (let id = 1; id <= 60; id++) {
        expect(await neighbours(d, q, id), `photo ${id}`).toEqual(
          windowReference(d, q, id),
        );
      }
    },
  );
});

describe("neighborsStatements plans", () => {
  // Each statement starts from an index on the list's order: no full scan
  // of media and no sort (D1 bills the rows a query reads).
  const d = migratedSqlite();
  const plan = (sql: string, args: unknown[]) =>
    (
      d.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as string[])) as {
        detail: string;
      }[]
    ).map((r) => r.detail);
  const anchors: NeighborAnchor[] = [
    { id: 5, path: "/a/b.png", timestamp: "2024-01-01" },
    { id: 5, path: "/a/b.png", timestamp: null },
  ];
  const lists = [
    list(),
    list({ visibility: "private", platform: "Real" }),
    list({ view: "files", dir: "/a" }),
    // The calendar's date filter is a range on the same index.
    list({ date: "2023-12" }),
    list({ view: "files", dir: "/a", date: "2023-12-04" }),
  ];
  for (const q of lists) {
    for (const a of anchors) {
      it(`${JSON.stringify(q)} ${a.timestamp}`, () => {
        for (const s of Object.values(neighborsStatements(q, a))) {
          const details = plan(s.sql, s.args);
          expect(details.join("\n")).not.toMatch(/SCAN media\b|TEMP B-TREE/);
          expect(details.some((x) => /USING .*INDEX/.test(x))).toBe(true);
        }
      });
    }
  }
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
