import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  calendarHref,
  calendarHrefFor,
  dateParam,
  parseCalendarParams,
  TAKEN_ON_SQL,
  takenOnArgs,
} from "./calendar";
import { filterChips, mediaListHref } from "./format";
import { neighborsStatements, parseListHref } from "./neighbors";

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

describe("TAKEN_ON_SQL on SQLite", () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  const insert = db.prepare(
    "INSERT INTO media (id, file, platform, timestamp) VALUES (?, ?, 'Real', ?)",
  );
  // The timestamp's own date: 00:30 JST on the 4th is the 4th.
  insert.run(1, "/a.png", "2023-12-04T00:30:00+09:00");
  insert.run(2, "/b.png", "2023-12-03T23:30:00Z");
  insert.run(3, "/c.png", "2024-01-01T00:00:00+09:00");
  insert.run(4, "/d.png", null);
  // Not ISO (old hand-made rows): the calendar cannot place it either.
  insert.run(5, "/e.png", "2023-12-04 10:00");
  const ids = (date: string) =>
    (
      db
        .prepare(`SELECT id FROM media WHERE ${TAKEN_ON_SQL} ORDER BY id`)
        .all(...takenOnArgs(date)) as { id: number }[]
    ).map((r) => r.id);

  it("matches a day, month or year by the photo's own date", () => {
    expect(ids("2023-12-04")).toEqual([1]);
    expect(ids("2023-12-03")).toEqual([2]);
    expect(ids("2023-12")).toEqual([1, 2]);
    expect(ids("2023")).toEqual([1, 2]);
    expect(ids("2024")).toEqual([3]);
  });

  it("is applied by the neighbours query", () => {
    // Photo 1 (the 4th) is the newest of December's two: one after it.
    const { counts } = neighborsStatements(
      parseListHref("/media/?date=2023-12"),
      { id: 1, path: "/a.png", timestamp: "2023-12-04T00:30:00+09:00" },
    );
    const row = db.prepare(counts.sql).get(...(counts.args as never[])) as {
      before: number;
      after: number;
    };
    expect(row).toEqual({ before: 0, after: 1 });
  });
});
