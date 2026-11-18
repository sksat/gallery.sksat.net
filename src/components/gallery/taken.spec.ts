import { describe, expect, it } from "vitest";

import { takenAt, takenJa, takenParts } from "./taken";

describe("takenAt", () => {
  it("keeps the photo's own clock, whatever the offset", () => {
    // 23:12 in +09:00 is 14:12 UTC; it still reads 23:12.
    expect(takenAt("2023-12-16T23:12:53+09:00", "second")).toEqual({
      text: "2023/12/16 23:12",
      datetime: "2023-12-16T23:12+09:00",
    });
    // Z reads in UTC, not converted to the viewer's or Tokyo's time.
    expect(takenAt("2023-12-02T00:00:00Z", null)).toEqual({
      text: "2023/12/02 00:00",
      datetime: "2023-12-02T00:00Z",
    });
    expect(takenAt("2023-12-16T23:12:00-05:00", "minute")).toEqual({
      text: "2023/12/16 23:12",
      datetime: "2023-12-16T23:12-05:00",
    });
    expect(takenAt("2023-12-02T00:00:00.123Z", "second")?.datetime).toBe(
      "2023-12-02T00:00Z",
    );
  });

  it("says no more than the precision", () => {
    const at = "2023-12-16T00:00:00+09:00";
    expect(takenAt(at, "date")).toEqual({
      text: "2023/12/16",
      datetime: "2023-12-16",
    });
    expect(takenAt(at, "month")).toEqual({
      text: "2023/12",
      datetime: "2023-12",
    });
    expect(takenAt(at, "year")).toEqual({ text: "2023", datetime: "2023" });
    // A date in its own offset, even where UTC is the day before.
    expect(takenAt("2023-12-16T00:00:00-05:00", "date")?.text).toBe(
      "2023/12/16",
    );
  });

  it("is null without a readable time", () => {
    expect(takenAt(null, "date")).toBeNull();
    expect(takenAt("yesterday", "second")).toBeNull();
  });
});

describe("takenJa", () => {
  it("writes the same moment in Japanese", () => {
    expect(takenJa("2023-12-16T23:12:25.684+09:00", "second")).toEqual({
      day: "2023年12月16日",
      full: "2023年12月16日 23:12",
    });
    expect(takenJa("2023-12-01T15:30:00Z", null)).toEqual({
      day: "2023年12月1日",
      full: "2023年12月1日 15:30",
    });
    expect(takenJa("2023-12-04T00:00:00+09:00", "date")).toEqual({
      day: "2023年12月4日",
      full: "2023年12月4日",
    });
    expect(takenJa("2023-12-01T00:00:00+09:00", "month")?.full).toBe(
      "2023年12月",
    );
    expect(takenJa("2023-01-01T00:00:00+09:00", "year")?.day).toBe("2023年");
    expect(takenJa(null, "date")).toBeNull();
  });
});

describe("takenParts", () => {
  it("reads a time with or without an offset", () => {
    expect(takenParts("2023-12-16T23:12:00+09:00", "minute")).toMatchObject({
      year: "2023",
      month: "12",
      day: "16",
      offset: "+09:00",
      precision: "minute",
    });
    expect(takenParts("2023-12-16 23:12:00", null)).toMatchObject({
      offset: null,
      precision: "second",
    });
  });
});
