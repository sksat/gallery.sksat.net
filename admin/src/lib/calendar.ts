// The admin's calendar (/calendar/): every listed photo (private ones too)
// by the date it was taken, in its own offset, to the day whatever its
// public taken_at level. The grids and views are shared with the public
// calendar (@shared/calendar/calendar); the counting is done in SQL here,
// a month or a year at a time, so a page reads only the photos it shows
// (D1 bills rows read).

import {
  monthKey,
  monthView,
  parseDateKey,
  yearKey,
  yearView,
  type CalendarIndex,
  type MonthView,
  type YearMonth,
  type YearView,
} from "@shared/calendar/calendar";

import { LIVE_PHOTO, type MediaPlatform } from "./types";

/** A timestamp that starts with an ISO date and "T" (checked from the index). */
const ISO_SQL = "timestamp GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'";

/**
 * Taken in a year, month or day ("2023", "2023-12", "2023-12-04"): the
 * timestamp's own date part starts with it. Bind with takenOnArgs.
 *
 * Timestamps are ISO strings in the photo's own offset
 * ("2023-12-04T00:30:00+09:00"), so their date part is already the local
 * date the calendar shows, and every string starting with a key sorts
 * between the key and the key followed by "~" (above every character an
 * ISO timestamp uses). A range on the raw string is therefore exact, with
 * no offset arithmetic, and it is a range on idx_media_live_timestamp
 * (migration 0007) rather than a scan of the library. ISO_SQL only drops
 * a row whose value is not ISO (old hand-made rows), as the calendar does.
 */
export const TAKEN_ON_SQL = `timestamp >= ? AND timestamp < ? AND ${ISO_SQL}`;

/** The bounds of a key's range: [key, key + "~"). */
export const takenOnArgs = (date: string): [string, string] => [
  date,
  `${date}~`,
];

/** `?date=` of a /media URL: a real year, month or day, else null. */
export const dateParam = (params: URLSearchParams): string | null => {
  const raw = params.get("date")?.trim();
  return raw && parseDateKey(raw) ? raw : null;
};

export type CalendarCover = {
  id: number;
  file: string;
  platform: MediaPlatform;
};

/** One day of a range: its count per visibility and its first photo. */
type DayRow = {
  day: string;
  id: number;
  file: string;
  platform: string;
  public: number;
  unlisted: number;
  private: number;
};

/**
 * The days of one month or year (`key`), counted in SQL: one row per day
 * with its counts per visibility and, with `covers`, the day's first photo
 * (by its local time) as SQLite's bare columns next to MIN(). Only that
 * range of idx_media_live_timestamp (and its rows) is read, never the
 * rest of the library.
 */
export const daysStatement = (db: D1Database, key: string, covers = true) =>
  db
    .prepare(
      `SELECT substr(timestamp, 1, 10) AS day, MIN(timestamp) AS first,
              ${covers ? "id, file, platform" : "0 AS id, '' AS file, '' AS platform"},
              SUM(visibility = 'public') AS public,
              SUM(visibility = 'unlisted') AS unlisted,
              SUM(visibility = 'private') AS private
       FROM media WHERE ${LIVE_PHOTO} AND ${TAKEN_ON_SQL}
       GROUP BY day`,
    )
    .bind(...takenOnArgs(key));

/**
 * The nearest year or month (as long as `key`) before or after `key` that
 * has a photo: one step of the index from the range's edge.
 */
export const neighborStatement = (
  db: D1Database,
  key: string,
  direction: "prev" | "next",
) =>
  db
    .prepare(
      `SELECT substr(timestamp, 1, ${key.length}) AS key FROM media
       WHERE ${LIVE_PHOTO} AND ${ISO_SQL} AND ${
         direction === "prev"
           ? "timestamp < ? ORDER BY timestamp DESC"
           : "timestamp >= ? ORDER BY timestamp"
       } LIMIT 1`,
    )
    .bind(direction === "prev" ? key : `${key}~`);

/** The newest dated photo's date, as a year-month key ("" if none). */
export const latestStatement = (db: D1Database) =>
  db.prepare(
    `SELECT substr(timestamp, 1, 7) AS key FROM media
     WHERE ${LIVE_PHOTO} AND ${ISO_SQL}
     ORDER BY timestamp DESC LIMIT 1`,
  );

/** Day rows as a calendar index (the days, and their month and year). */
export const indexFromDays = (
  rows: readonly DayRow[],
): CalendarIndex<CalendarCover> => {
  const index: CalendarIndex<CalendarCover> = {
    days: {},
    months: {},
    years: {},
  };
  for (const r of rows) {
    const p = parseDateKey(r.day);
    if (!p || p.day === undefined) continue;
    const kinds: Record<string, number> = {};
    for (const v of ["public", "unlisted", "private"] as const) {
      if (r[v] > 0) kinds[v] = r[v];
    }
    const count = r.public + r.unlisted + r.private;
    index.days[r.day] = {
      count,
      cover: {
        id: r.id,
        file: r.file,
        platform: r.platform === "VRChat" ? "VRChat" : "Real",
      },
      kinds,
    };
    for (const [map, k] of [
      [index.months, r.day.slice(0, 7)],
      [index.years, r.day.slice(0, 4)],
    ] as const) {
      const b = (map[k] ??= { count: 0, undated: 0 });
      b.count += count;
    }
  }
  return index;
};

const keyOf = (res: D1Result<unknown>): string | null =>
  ((res.results ?? [])[0] as { key?: string } | undefined)?.key ?? null;

const toYearMonth = (key: string | null): YearMonth | null => {
  const p = parseDateKey(key);
  return p && p.month !== undefined ? { year: p.year, month: p.month } : null;
};

/** One month of the calendar, in one batch of three range reads. */
export const loadMonth = async (
  db: D1Database,
  year: number,
  month: number,
): Promise<MonthView<CalendarCover>> => {
  const key = monthKey(year, month);
  const [days, prev, next] = await db.batch([
    daysStatement(db, key),
    neighborStatement(db, key, "prev"),
    neighborStatement(db, key, "next"),
  ]);
  return {
    ...monthView(indexFromDays((days.results ?? []) as DayRow[]), year, month),
    prev: toYearMonth(keyOf(prev)),
    next: toYearMonth(keyOf(next)),
  };
};

/** One year of the calendar, in one batch of three range reads. */
export const loadYear = async (
  db: D1Database,
  year: number,
): Promise<YearView> => {
  const key = yearKey(year);
  const [days, prev, next] = await db.batch([
    // The year view shows no pictures: no covers to look up.
    daysStatement(db, key, false),
    neighborStatement(db, key, "prev"),
    neighborStatement(db, key, "next"),
  ]);
  const toYear = (k: string | null) => parseDateKey(k)?.year ?? null;
  return {
    ...yearView(indexFromDays((days.results ?? []) as DayRow[]), year),
    prev: toYear(keyOf(prev)),
    next: toYear(keyOf(next)),
  };
};

/** The newest month with a photo (one index step), or null. */
export const loadLatestMonth = async (
  db: D1Database,
): Promise<YearMonth | null> =>
  toYearMonth(keyOf(await latestStatement(db).all()));

const pad2 = (n: number) => String(n).padStart(2, "0");

export const calendarHref = (year?: number, month?: number): string =>
  year === undefined
    ? "/calendar/"
    : month === undefined
      ? `/calendar/${year}/`
      : `/calendar/${year}/${pad2(month)}/`;

/** The calendar page of a /media date filter: its month, or its year. */
export const calendarHrefFor = (date: string): string => {
  const p = parseDateKey(date);
  return p ? calendarHref(p.year, p.month) : calendarHref();
};

/** /calendar/<yyyy>/[<mm>/] params; null unless a real year (and month). */
export const parseCalendarParams = (
  year: string,
  month?: string,
): { year: number; month?: number } | null => {
  if (!/^\d{4}$/.test(year)) return null;
  if (month !== undefined && !/^\d\d$/.test(month)) return null;
  const p = parseDateKey(month === undefined ? year : `${year}-${month}`);
  return p ? { year: p.year, month: p.month } : null;
};
