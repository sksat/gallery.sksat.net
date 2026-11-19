import { describe, expect, it } from "vitest";

import {
  calendarHref,
  calendarHrefFor,
  dateParam,
  daysStatement,
  latestStatement,
  loadLatestMonth,
  loadMonth,
  loadYear,
  neighborStatement,
  parseCalendarParams,
  TAKEN_ON_SQL,
  takenOnArgs,
} from "./calendar";
import { listMedia } from "./db";
import { filesQuery } from "./db-files";
import { filterChips, mediaListHref } from "./format";
import { neighborsStatements, parseListHref } from "./neighbors";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

describe("dateParam", () => {
  it("reads a real year, month or day", () => {
    const p = (q: string) => dateParam(new URLSearchParams(q));
    expect(p("date=2023-12-04")).toBe("2023-12-04");
    expect(p("date=2023-12")).toBe("2023-12");
    expect(p("date=2023")).toBe("2023");
    expect(p("date=2023-02-29")).toBeNull();
    expect(p("date=%25")).toBeNull();
    expect(p("")).toBeNull();
  });
});

it("calendar hrefs and params", () => {
  expect(calendarHref()).toBe("/calendar/");
  expect(calendarHref(2023)).toBe("/calendar/2023/");
  expect(calendarHref(2023, 1)).toBe("/calendar/2023/01/");
  expect(calendarHrefFor("2023-12-04")).toBe("/calendar/2023/12/");
  expect(calendarHrefFor("2023")).toBe("/calendar/2023/");
  expect(parseCalendarParams("2023", "12")).toEqual({ year: 2023, month: 12 });
  expect(parseCalendarParams("2023")).toEqual({ year: 2023 });
  expect(parseCalendarParams("2023", "13")).toBeNull();
  expect(parseCalendarParams("2023", "1")).toBeNull();
});

describe("the date filter in /media URLs", () => {
  it("is kept in list URLs and dropped by its chip", () => {
    expect(mediaListHref({ date: "2023-12-04" })).toBe(
      "/media/?date=2023-12-04",
    );
    const chips = filterChips({
      view: "list",
      dir: "/",
      platform: "VRChat",
      visibility: null,
      q: "",
      date: "2023-12",
      visibilityLabel: (v) => v,
    });
    expect(chips.map((c) => [c.label, c.href])).toEqual([
      ["VRChat", "/media/?date=2023-12"],
      ["2023年12月", "/media/?platform=VRChat"],
    ]);
  });

  it("follows the edit page's prev/next", () => {
    expect(parseListHref("/media/?date=2023-12&page=2")).toMatchObject({
      date: "2023-12",
      page: 2,
    });
    expect(parseListHref("/media/?date=bogus").date).toBeNull();
  });
});

describe("the calendar on SQLite", () => {
  const db = migratedSqlite();
  const insert = db.prepare(
    "INSERT INTO media (id, file, platform, timestamp, visibility) VALUES (?, ?, 'Real', ?, ?)",
  );
  // The timestamp's own date: 00:30 JST on the 4th is the 4th.
  insert.run(1, "/a.png", "2023-12-04T00:30:00+09:00", "public");
  insert.run(2, "/b.png", "2023-12-03T23:30:00Z", "private");
  insert.run(3, "/c.png", "2024-01-01T00:00:00+09:00", "unlisted");
  insert.run(4, "/d.png", null, "public");
  // Not ISO (old hand-made rows): the calendar cannot place it either.
  insert.run(5, "/e.png", "2023-12-04 10:00", "public");
  // Later the same (local) day as photo 1, though earlier in UTC terms of
  // another offset: the day's cover is its first photo by local time.
  insert.run(6, "/f.png", "2023-12-04T09:00:00-05:00", "private");
  insert.run(7, "/g.png", "2022-06-01T12:00:00Z", "public");
  const d1 = sqliteD1(db);
  const ids = (date: string) =>
    (
      db
        .prepare(`SELECT id FROM media WHERE ${TAKEN_ON_SQL} ORDER BY id`)
        .all(...takenOnArgs(date)) as { id: number }[]
    ).map((r) => r.id);

  it("matches a day, month or year by the photo's own date", () => {
    expect(ids("2023-12-04")).toEqual([1, 6]);
    expect(ids("2023-12-03")).toEqual([2]);
    expect(ids("2023-12")).toEqual([1, 2, 6]);
    expect(ids("2023")).toEqual([1, 2, 6]);
    expect(ids("2024")).toEqual([3]);
  });

  it("is applied by the neighbours query", () => {
    // Photo 6 (later on the 4th) is December's newest: two after it.
    const { counts } = neighborsStatements(
      parseListHref("/media/?date=2023-12"),
      { id: 6, path: "/f.png", timestamp: "2023-12-04T09:00:00-05:00" },
    );
    const row = db.prepare(counts.sql).get(...(counts.args as never[])) as {
      before: number;
      after: number;
    };
    expect(row).toEqual({ before: 0, after: 2 });
  });

  it("loads a month: days, visibility, covers and its neighbours", async () => {
    const v = await loadMonth(d1, 2023, 12);
    const days = v.weeks.flat().filter((c) => c !== null && c.count > 0);
    expect(days.map((c) => [c!.key, c!.count, c!.kinds, c!.cover?.id])).toEqual(
      [
        ["2023-12-03", 1, { private: 1 }, 2],
        ["2023-12-04", 2, { public: 1, private: 1 }, 1],
      ],
    );
    expect(v.count).toBe(3);
    expect(v.prev).toEqual({ year: 2022, month: 6 });
    expect(v.next).toEqual({ year: 2024, month: 1 });
    // An empty month still finds both sides.
    const empty = await loadMonth(d1, 2023, 3);
    expect(empty.count).toBe(0);
    expect(empty.prev).toEqual({ year: 2022, month: 6 });
    expect(empty.next).toEqual({ year: 2023, month: 12 });
  });

  it("loads a year and the newest month", async () => {
    const y = await loadYear(d1, 2023);
    expect(y.count).toBe(3);
    expect(y.months[11].count).toBe(3);
    expect(y.prev).toBe(2022);
    expect(y.next).toBe(2024);
    expect(await loadLatestMonth(d1)).toEqual({ year: 2024, month: 1 });
  });

  describe("plans: a range of idx_media_live_timestamp, never the library", () => {
    const plan = (sql: string, args: unknown[]) =>
      (
        db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as string[])) as {
          detail: string;
        }[]
      )
        .map((r) => r.detail)
        .join("\n");
    const statements = (): [string, { sql: string; args: unknown[] }][] => {
      const s = (st: D1PreparedStatement) =>
        st as unknown as { sql: string; args: unknown[] };
      return [
        ["days", s(daysStatement(d1, "2023-12"))],
        ["prev", s(neighborStatement(d1, "2023-12", "prev"))],
        ["next", s(neighborStatement(d1, "2023", "next"))],
        ["latest", s(latestStatement(d1))],
      ];
    };
    for (const [name, st] of statements()) {
      it(name, () => {
        const p = plan(st.sql, st.args);
        expect(p).toMatch(/USING .*INDEX idx_media_live_timestamp/);
        // The days are a SEARCH (a range); "latest" walks the index from
        // its end and stops at the LIMIT. Never a scan of the table.
        expect(p).not.toMatch(/SCAN media(?! USING)/);
        if (name !== "latest") expect(p).toMatch(/SEARCH media/);
      });
    }
    it("the list and Files view with a date", () => {
      const { sql, args } = filesQuery({ date: "2023-12-04", limit: 10 });
      expect(plan(sql, args)).not.toMatch(/SCAN media(?! USING)/);
    });

    it("listMedia with a date: a range that stops at the page, no sort", async () => {
      // Record what listMedia runs, then look at each plan.
      const seen: { sql: string; args: unknown[] }[] = [];
      const recording = {
        prepare: (sql: string) => {
          const st = d1.prepare(sql);
          return {
            bind: (...args: unknown[]) => {
              seen.push({ sql, args });
              return st.bind(...args);
            },
          };
        },
      } as unknown as D1Database;
      const { rows, total } = await listMedia(recording, {
        date: "2023-12",
        limit: 100,
        offset: 0,
      });
      expect(rows.map((r) => r.id)).toEqual([6, 1, 2]);
      expect(total).toBe(3);
      expect(seen).toHaveLength(2);
      for (const s of seen) {
        const p = plan(s.sql, s.args);
        expect(p).toMatch(
          /SEARCH media USING .*INDEX idx_media_live_timestamp/,
        );
        // The page itself is not sorted; only it is, again, once its
        // cameras are joined (after `SCAN m`).
        expect(p.split(/\nSCAN m\b/)[0]).not.toMatch(/TEMP B-TREE/);
      }
    });
  });
});
