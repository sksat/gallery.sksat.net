/**
 * The public calendar (/calendar/): photos counted by the date they were
 * taken, as precisely as each photo's metadata level makes it public
 * (shared/calendar/calendar.ts does the counting).
 */
import {
  buildCalendar,
  monthKey,
  parseDateKey,
  yearKey,
  takenDateKey,
  type CalendarIndex,
  type DateKey,
} from "@shared/calendar/calendar";

import type { ImageSource } from "./images";
import { parseMediaTimestamp, type MediaInfoJSON } from "./types";

export const CALENDAR_HREF = "/calendar/";

/** /calendar/<yyyy>/ or /calendar/<yyyy>/<mm>/. */
export const calendarHref = (year: number, month?: number): string =>
  `${CALENDAR_HREF}${(month === undefined ? yearKey(year) : monthKey(year, month)).replace("-", "/")}/`;

/** The gallery of one year, month or day. */
export const dateGalleryHref = (key: DateKey): string => `/?date=${key}`;

/** The calendar page a date filter came from: its month, or its year. */
export const calendarHrefFor = (key: DateKey): string => {
  const p = parseDateKey(key);
  if (!p) return CALENDAR_HREF;
  return calendarHref(p.year, p.month);
};

/**
 * The public photos (the API's list, already cut to each photo's taken_at
 * level) by date. Hidden dates are left out.
 */
export const publicCalendar = (
  media: readonly MediaInfoJSON[],
): CalendarIndex<ImageSource> =>
  buildCalendar(
    media.map((m) => ({
      key: takenDateKey(m.timestamp, m.timestamp_precision),
      time: parseMediaTimestamp(m.timestamp)?.getTime() ?? 0,
      cover: { id: m.id, file: m.file },
    })),
  );

/** The year and month of a /calendar/<year>/<month>/ path; null if not real. */
export const parseCalendarParams = (
  year: string,
  month?: string,
): { year: number; month?: number } | null => {
  if (!/^\d{4}$/.test(year)) return null;
  if (month === undefined) {
    const p = parseDateKey(year);
    return p ? { year: p.year } : null;
  }
  if (!/^\d\d$/.test(month)) return null;
  const p = parseDateKey(`${year}-${month}`);
  return p && p.month !== undefined ? { year: p.year, month: p.month } : null;
};
