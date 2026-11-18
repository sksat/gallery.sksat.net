import { describe, expect, it } from "vitest";

import {
  buildCalendar,
  formatDateKey,
  heatLevel,
  inDate,
  latestMonth,
  latestYear,
  monthView,
  monthWeeks,
  neighborKey,
  parseDateKey,
  takenDateKey,
  yearView,
  type CalendarEntry,
} from "./calendar";

describe("parseDateKey", () => {
  it("accepts a year, month or real day", () => {
    expect(parseDateKey("2023")).toEqual({ year: 2023 });
    expect(parseDateKey("2023-12")).toEqual({ year: 2023, month: 12 });
    expect(parseDateKey("2024-02-29")).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it("rejects anything else", () => {
    for (const s of [
      null,
      "",
      "2023-13",
      "2023-00",
      "2023-02-29",
      "2023-04-31",
      "2023-1-01",
      "2023-12-04T00:00",
      "0000",
      "abcd",
    ]) {
      expect(parseDateKey(s)).toBeNull();
    }
  });
});

describe("takenDateKey", () => {
  it("uses the photo's own offset (the timestamp's date part)", () => {
    // 2023-12-04T00:30 JST is 2023-12-03 in UTC: still the 4th.
    expect(takenDateKey("2023-12-04T00:30:00+09:00", "second")).toBe(
      "2023-12-04",
    );
    expect(takenDateKey("2023-12-03T23:30:00-05:00", "minute")).toBe(
      "2023-12-03",
    );
    expect(takenDateKey("2023-12-04T00:00:00Z", null)).toBe("2023-12-04");
  });

  it("cuts to the precision", () => {
    const ts = "2023-12-04T00:00:00+09:00";
    expect(takenDateKey(ts, "date")).toBe("2023-12-04");
    expect(takenDateKey(ts, "month")).toBe("2023-12");
    expect(takenDateKey(ts, "year")).toBe("2023");
  });

  it("is null without a usable date", () => {
    expect(takenDateKey(null, "second")).toBeNull();
    expect(takenDateKey("yesterday", "second")).toBeNull();
    expect(takenDateKey("2023-02-30T00:00:00Z", "second")).toBeNull();
  });
});

describe("inDate", () => {
  it("matches a day only for photos dated to it", () => {
    expect(inDate("2023-12-04", "2023-12-04")).toBe(true);
    expect(inDate("2023-12", "2023-12-04")).toBe(false);
    expect(inDate("2023", "2023-12-04")).toBe(false);
  });

  it("matches a month or year for everything in it", () => {
    expect(inDate("2023-12-04", "2023-12")).toBe(true);
    expect(inDate("2023-12", "2023-12")).toBe(true);
    expect(inDate("2023", "2023-12")).toBe(false);
    expect(inDate("2023-12-04", "2023")).toBe(true);
    expect(inDate("2023", "2023")).toBe(true);
    expect(inDate("2023-01-01", "2023-1")).toBe(false);
    expect(inDate(null, "2023")).toBe(false);
  });
});

it("formatDateKey", () => {
  expect(formatDateKey("2023-12-04")).toBe("2023年12月4日");
  expect(formatDateKey("2023-02")).toBe("2023年2月");
  expect(formatDateKey("2023")).toBe("2023年");
});

describe("monthWeeks", () => {
  it("starts on Sunday and pads both ends", () => {
    // 2023-12-01 is a Friday.
    const weeks = monthWeeks(2023, 12);
    expect(weeks[0]).toEqual([null, null, null, null, null, 1, 2]);
    expect(weeks.at(-1)).toEqual([31, null, null, null, null, null, null]);
    expect(weeks).toHaveLength(6);
  });

  it("has four rows for a February that fits exactly", () => {
    // 2026-02-01 is a Sunday, 28 days.
    expect(monthWeeks(2026, 2)).toHaveLength(4);
  });
});

const entry = (
  key: string | null,
  cover: string,
  time = 0,
  kind?: string,
): CalendarEntry<string> => ({ key, cover, time, kind });

describe("buildCalendar", () => {
  const index = buildCalendar([
    entry("2023-12-04", "late", 20, "public"),
    entry("2023-12-04", "early", 10, "private"),
    entry("2023-12-04", "later", 30, "public"),
    entry("2023-12-05", "x"),
    entry("2023-12", "month-only"),
    entry("2023", "year-only"),
    entry("2024-01-02", "y"),
    entry(null, "undated"),
    entry("bogus", "bad"),
  ]);

  it("counts days with the earliest photo as the cover", () => {
    expect(index.days["2023-12-04"]).toEqual({
      count: 3,
      cover: "early",
      kinds: { public: 2, private: 1 },
    });
    expect(Object.keys(index.days).sort()).toEqual([
      "2023-12-04",
      "2023-12-05",
      "2024-01-02",
    ]);
  });

  it("puts month-only photos in the month and year, year-only in the year", () => {
    expect(index.months["2023-12"]).toEqual({ count: 5, undated: 1 });
    expect(index.years["2023"]).toEqual({ count: 6, undated: 1 });
    expect(index.years["2024"]).toEqual({ count: 1, undated: 0 });
  });

  it("finds the latest month", () => {
    expect(latestMonth(index)).toEqual({ year: 2024, month: 1 });
    expect(latestMonth(buildCalendar([entry("2023", "y")]))).toBeNull();
  });

  it("finds the latest year, even one known only to the year", () => {
    expect(latestYear(index)).toBe(2024);
    expect(latestYear(buildCalendar([entry("2023", "y")]))).toBe(2023);
    expect(latestYear(buildCalendar([]))).toBeNull();
  });

  it("builds a month view with neighbours that have photos", () => {
    const v = monthView(index, 2023, 12);
    expect(v.count).toBe(5);
    expect(v.undated).toBe(1);
    expect(v.prev).toBeNull();
    expect(v.next).toEqual({ year: 2024, month: 1 });
    const cells = v.weeks.flat().filter((c) => c !== null);
    expect(cells).toHaveLength(31);
    expect(cells[3]).toMatchObject({ day: 4, count: 3, cover: "early" });
    expect(cells[0]).toMatchObject({ day: 1, count: 0, cover: null });
    // An empty month far away still knows its neighbours.
    expect(monthView(index, 2030, 5).prev).toEqual({ year: 2024, month: 1 });
  });

  it("builds a year view shaded by count", () => {
    const v = yearView(index, 2023);
    expect(v.count).toBe(6);
    expect(v.undated).toBe(1);
    expect(v.next).toBe(2024);
    expect(v.prev).toBeNull();
    const dec = v.months[11];
    expect(dec.count).toBe(5);
    const days = dec.weeks.flat().filter((c) => c !== null);
    expect(days[3]).toMatchObject({ key: "2023-12-04", count: 3, level: 4 });
    expect(days[4]).toMatchObject({ key: "2023-12-05", count: 1, level: 1 });
    expect(days[0].level).toBe(0);
  });
});

it("neighborKey", () => {
  const keys = ["2023-01", "2023-05", "2022-11"];
  expect(neighborKey(keys, "2023-03", "prev")).toBe("2023-01");
  expect(neighborKey(keys, "2023-03", "next")).toBe("2023-05");
  expect(neighborKey(keys, "2023-05", "next")).toBeNull();
  expect(neighborKey(keys, "2023-01", "prev")).toBe("2022-11");
});

it("heatLevel", () => {
  expect(heatLevel(0, 10)).toBe(0);
  expect(heatLevel(1, 1)).toBe(4);
  expect(heatLevel(1, 100)).toBe(1);
  expect(heatLevel(10, 100)).toBe(3);
  expect(heatLevel(100, 100)).toBe(4);
});
