// The admin's calendar (/calendar/): every listed photo (private ones too)
// by the date it was taken, in its own offset, to the day whatever its
// public taken_at level. The counting is shared with the public calendar
// (@shared/calendar/calendar).

import {
  buildCalendar,
  parseDateKey,
  takenDateKey,
  type CalendarIndex,
} from "@shared/calendar/calendar";

import { LIVE_PHOTO, isVisibility, type MediaPlatform } from "./types";

/**
 * Taken in a year, month or day: the timestamp's own date part starts with
 * it (ISO strings, so "2023-12" matches "2023-12-04T…"). Bind with
 * takenOnArgs.
 */
export const TAKEN_ON_SQL =
  "substr(timestamp, 1, ?) = ? AND substr(timestamp, 11, 1) = 'T'";

export const takenOnArgs = (date: string): [number, string] => [
  date.length,
  date,
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

type Row = {
  id: number;
  file: string;
  platform: string;
  timestamp: string;
  visibility: string;
};

/** Every listed photo with a time, by date, counted per visibility. */
export const loadCalendar = async (
  db: D1Database,
): Promise<CalendarIndex<CalendarCover>> => {
  const res = await db
    .prepare(
      `SELECT id, file, platform, timestamp, visibility FROM media
       WHERE ${LIVE_PHOTO} AND timestamp IS NOT NULL`,
    )
    .all<Row>();
  return buildCalendar(
    (res.results ?? []).map((r) => {
      const time = new Date(r.timestamp).getTime();
      return {
        key: takenDateKey(r.timestamp, "second"),
        time: Number.isNaN(time) ? 0 : time,
        cover: {
          id: r.id,
          file: r.file,
          platform: r.platform === "VRChat" ? "VRChat" : "Real",
        },
        kind: isVisibility(r.visibility) ? r.visibility : undefined,
      };
    }),
  );
};

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
