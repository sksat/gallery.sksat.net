import { describe, expect, it } from "vitest";

import {
  calendarHref,
  calendarHrefFor,
  dateGalleryHref,
  parseCalendarParams,
  publicCalendar,
} from "./calendar";
import type { MediaInfoJSON } from "./types";

const photo = (
  id: string,
  timestamp: string | null,
  timestamp_precision: MediaInfoJSON["timestamp_precision"],
): MediaInfoJSON => ({
  id,
  file: `/${id}.png`,
  platform: "Real",
  timestamp,
  timestamp_precision,
  camera: null,
  tags: [],
});

describe("publicCalendar", () => {
  // As the API returns them: already cut to each photo's taken_at level.
  const index = publicCalendar([
    photo("aaaaaaaaaa", "2023-12-04T23:30:00+09:00", "second"),
    photo("bbbbbbbbbb", "2023-12-04T08:00:00+09:00", "minute"),
    photo("cccccccccc", "2023-12-04T00:00:00+09:00", "date"),
    photo("dddddddddd", "2023-12-01T00:00:00+09:00", "month"),
    photo("eeeeeeeeee", "2023-01-01T00:00:00+09:00", "year"),
    photo("ffffffffff", null, null),
  ]);

  it("counts each photo on its own local day", () => {
    // 23:30 JST on the 4th is the 4th, though it is the 4th 14:30 UTC;
    // and the date-level photo (00:00 JST) is the 3rd in UTC.
    expect(index.days["2023-12-04"].count).toBe(3);
    expect(index.days["2023-12-03"]).toBeUndefined();
  });

  it("takes the day's earliest photo as its cover", () => {
    expect(index.days["2023-12-04"].cover).toEqual({
      id: "cccccccccc",
      file: "/cccccccccc.png",
    });
  });

  it("keeps month- and year-only photos off the days", () => {
    expect(Object.keys(index.days)).toEqual(["2023-12-04"]);
    expect(index.months["2023-12"]).toEqual({ count: 4, undated: 1 });
    expect(index.months["2023-01"]).toBeUndefined();
    expect(index.years["2023"]).toEqual({ count: 5, undated: 1 });
  });
});

describe("parseCalendarParams", () => {
  it("accepts /calendar/<yyyy>/<mm>/", () => {
    expect(parseCalendarParams("2023")).toEqual({ year: 2023 });
    expect(parseCalendarParams("2023", "01")).toEqual({
      year: 2023,
      month: 1,
    });
  });

  it("rejects anything else", () => {
    expect(parseCalendarParams("23")).toBeNull();
    expect(parseCalendarParams("2023", "1")).toBeNull();
    expect(parseCalendarParams("2023", "13")).toBeNull();
    expect(parseCalendarParams("abcd")).toBeNull();
    expect(parseCalendarParams("0000")).toBeNull();
  });
});

it("hrefs", () => {
  expect(calendarHref(2023)).toBe("/calendar/2023/");
  expect(calendarHref(2023, 1)).toBe("/calendar/2023/01/");
  expect(dateGalleryHref("2023-12-04")).toBe("/?date=2023-12-04");
  expect(calendarHrefFor("2023-12-04")).toBe("/calendar/2023/12/");
  expect(calendarHrefFor("2023-12")).toBe("/calendar/2023/12/");
  expect(calendarHrefFor("2023")).toBe("/calendar/2023/");
});
