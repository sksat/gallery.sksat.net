/**
 * Calendar of photos by the date they were taken, shared by the public
 * gallery (/calendar/) and the admin (/calendar/). Pure: the pages feed
 * it photos and render what it returns.
 *
 * Dates are keys in the photo's own offset, as precise as known:
 * "2023-12-04" (a day), "2023-12" (a month) or "2023" (a year). The local
 * date is the timestamp's own date part: a photo taken at 00:30 in JST is
 * on that JST day wherever it is viewed.
 */

/** "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
export type DateKey = string;

export type DateParts = { year: number; month?: number; day?: number };

const KEY_RE = /^(\d{4})(?:-(\d\d)(?:-(\d\d))?)?$/;

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A date key's parts, or null unless it is a real year, month or day. */
export const parseDateKey = (
  raw: string | null | undefined,
): DateParts | null => {
  const m = raw ? KEY_RE.exec(raw) : null;
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1) return null;
  if (m[2] === undefined) return { year };
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (m[3] === undefined) return { year, month };
  const day = Number(m[3]);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const yearKey = (year: number): DateKey => pad(year, 4);

export const monthKey = (year: number, month: number): DateKey =>
  `${yearKey(year)}-${pad(month)}`;

export const dayKey = (year: number, month: number, day: number): DateKey =>
  `${monthKey(year, month)}-${pad(day)}`;

/** How precisely a photo's time is known (the API's timestamp_precision). */
export type Precision = "second" | "minute" | "date" | "month" | "year";

const TS_DATE_RE = /^(\d{4})-(\d\d)-(\d\d)T/;

/**
 * The date key of a photo: the date part of its timestamp (its own
 * offset), cut to its precision. Null when the time is unknown or hidden.
 * A missing precision means the full timestamp.
 */
export const takenDateKey = (
  timestamp: string | null | undefined,
  precision: Precision | null | undefined,
): DateKey | null => {
  const m = timestamp ? TS_DATE_RE.exec(timestamp) : null;
  if (!m || !parseDateKey(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  switch (precision) {
    case "year":
      return m[1];
    case "month":
      return `${m[1]}-${m[2]}`;
    default:
      return `${m[1]}-${m[2]}-${m[3]}`;
  }
};

/**
 * Whether a photo dated `key` falls in `filter` (a year, month or day).
 * A photo known only to the month is in that month and year but on no
 * day; one known only to the year is in no month.
 */
export const inDate = (key: DateKey | null, filter: DateKey): boolean =>
  key !== null && (key === filter || key.startsWith(`${filter}-`));

/** "2023年12月4日", "2023年12月" or "2023年". */
export const formatDateKey = (key: DateKey): string => {
  const p = parseDateKey(key);
  if (!p) return key;
  let s = `${p.year}年`;
  if (p.month !== undefined) s += `${p.month}月`;
  if (p.day !== undefined) s += `${p.day}日`;
  return s;
};

/** Sunday first, as Japanese wall calendars. */
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * The weeks of a month, Sunday first: day numbers, null for the days of
 * the months before and after.
 */
export const monthWeeks = (
  year: number,
  month: number,
): (number | null)[][] => {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = daysInMonth(year, month);
  const cells: (number | null)[] = [
    ...Array<null>(first).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
};

/** One photo as the calendar counts it. */
export type CalendarEntry<C> = {
  key: DateKey | null;
  /** Sorts the photos of a day (the earliest is its cover); ms. */
  time: number;
  cover: C;
  /** Counted per value on each day (the admin: visibility). */
  kind?: string;
};

export type DayBucket<C> = {
  count: number;
  /** The day's earliest photo. */
  cover: C;
  kinds: Record<string, number>;
};

export type Bucket = {
  /** Every photo in the month or year, those on a known day included. */
  count: number;
  /** Known only to this month (in a month) or this year (in a year). */
  undated: number;
};

export type CalendarIndex<C> = {
  days: Record<DateKey, DayBucket<C>>;
  months: Record<DateKey, Bucket>;
  years: Record<DateKey, Bucket>;
};

/** Count the photos by day, month and year. Undated photos are left out. */
export const buildCalendar = <C>(
  entries: readonly CalendarEntry<C>[],
): CalendarIndex<C> => {
  const index: CalendarIndex<C> = { days: {}, months: {}, years: {} };
  const firstTime: Record<DateKey, number> = {};
  const bump = (
    map: Record<DateKey, Bucket>,
    key: DateKey,
    undated: boolean,
  ) => {
    const b = (map[key] ??= { count: 0, undated: 0 });
    b.count++;
    if (undated) b.undated++;
  };
  for (const e of entries) {
    const p = parseDateKey(e.key);
    if (!p || e.key === null) continue;
    bump(index.years, pad(p.year, 4), p.month === undefined);
    if (p.month === undefined) continue;
    bump(index.months, monthKey(p.year, p.month), p.day === undefined);
    if (p.day === undefined) continue;
    const day = index.days[e.key];
    if (!day) {
      index.days[e.key] = {
        count: 1,
        cover: e.cover,
        kinds: e.kind ? { [e.kind]: 1 } : {},
      };
      firstTime[e.key] = e.time;
      continue;
    }
    day.count++;
    if (e.kind) day.kinds[e.kind] = (day.kinds[e.kind] ?? 0) + 1;
    if (e.time < firstTime[e.key]) {
      day.cover = e.cover;
      firstTime[e.key] = e.time;
    }
  }
  return index;
};

export type YearMonth = { year: number; month: number };

/** The newest month with photos, or null when nothing is dated that well. */
export const latestMonth = (
  index: CalendarIndex<unknown>,
): YearMonth | null => {
  const last = Object.keys(index.months).sort().at(-1);
  const p = parseDateKey(last);
  return p && p.month !== undefined ? { year: p.year, month: p.month } : null;
};

/** The newest year with photos (some may be known only to the year). */
export const latestYear = (index: CalendarIndex<unknown>): number | null => {
  const last = Object.keys(index.years).sort().at(-1);
  return last === undefined ? null : Number(last);
};

/** The nearest key before / after `key` among `keys` (any order). */
export const neighborKey = (
  keys: readonly DateKey[],
  key: DateKey,
  direction: "prev" | "next",
): DateKey | null => {
  let best: DateKey | null = null;
  for (const k of keys) {
    if (direction === "prev" ? k < key : k > key) {
      if (best === null || (direction === "prev" ? k > best : k < best)) {
        best = k;
      }
    }
  }
  return best;
};

/** 0 (none) to 4 (busiest), on a log scale so one busy day does not wash out the rest. */
export const heatLevel = (count: number, max: number): 0 | 1 | 2 | 3 | 4 => {
  if (count <= 0 || max <= 0) return 0;
  if (max === 1) return 4;
  const r = Math.log(count) / Math.log(max);
  return r >= 0.75 ? 4 : r >= 0.5 ? 3 : r >= 0.25 ? 2 : 1;
};

export type DayCell<C> = {
  day: number;
  key: DateKey;
  count: number;
  cover: C | null;
  kinds: Record<string, number>;
};

export type MonthView<C> = {
  year: number;
  month: number;
  key: DateKey;
  weeks: (DayCell<C> | null)[][];
  count: number;
  undated: number;
  /** The nearest months with photos. */
  prev: YearMonth | null;
  next: YearMonth | null;
};

const toYearMonth = (key: DateKey | null): YearMonth | null => {
  const p = parseDateKey(key);
  return p && p.month !== undefined ? { year: p.year, month: p.month } : null;
};

/** One month: its days with their photos, and where to go next. */
export const monthView = <C>(
  index: CalendarIndex<C>,
  year: number,
  month: number,
): MonthView<C> => {
  const key = monthKey(year, month);
  const months = Object.keys(index.months);
  return {
    year,
    month,
    key,
    weeks: monthWeeks(year, month).map((week) =>
      week.map((day) => {
        if (day === null) return null;
        const k = dayKey(year, month, day);
        const b = index.days[k];
        return {
          day,
          key: k,
          count: b?.count ?? 0,
          cover: b?.cover ?? null,
          kinds: b?.kinds ?? {},
        };
      }),
    ),
    count: index.months[key]?.count ?? 0,
    undated: index.months[key]?.undated ?? 0,
    prev: toYearMonth(neighborKey(months, key, "prev")),
    next: toYearMonth(neighborKey(months, key, "next")),
  };
};

export type HeatCell = {
  day: number;
  key: DateKey;
  count: number;
  level: number;
};

export type YearView = {
  year: number;
  key: DateKey;
  count: number;
  undated: number;
  months: {
    month: number;
    key: DateKey;
    count: number;
    weeks: (HeatCell | null)[][];
  }[];
  /** The nearest years with photos. */
  prev: number | null;
  next: number | null;
};

/** One year as twelve small months, each day shaded by its photo count. */
export const yearView = (
  index: CalendarIndex<unknown>,
  year: number,
): YearView => {
  const key = pad(year, 4);
  const prefix = `${key}-`;
  const max = Math.max(
    0,
    ...Object.entries(index.days)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, b]) => b.count),
  );
  const years = Object.keys(index.years);
  const near = (d: "prev" | "next") => {
    const k = neighborKey(years, key, d);
    return k === null ? null : Number(k);
  };
  return {
    year,
    key,
    count: index.years[key]?.count ?? 0,
    undated: index.years[key]?.undated ?? 0,
    months: Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const mk = monthKey(year, month);
      return {
        month,
        key: mk,
        count: index.months[mk]?.count ?? 0,
        weeks: monthWeeks(year, month).map((week) =>
          week.map((day) => {
            if (day === null) return null;
            const k = dayKey(year, month, day);
            const count = index.days[k]?.count ?? 0;
            return { day, key: k, count, level: heatLevel(count, max) };
          }),
        ),
      };
    }),
    prev: near("prev"),
    next: near("next"),
  };
};
