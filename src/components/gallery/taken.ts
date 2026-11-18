// When a photo was taken, for display: the one place the public site turns
// a timestamp into text (the grid captions, the info panel, the photo page
// and its og:description), so they never disagree. Always in the photo's
// own offset, as the API wrote it (production timestamps carry +09:00): a
// photo taken at 23:12 in Tokyo reads 23:12 wherever it is viewed, and a
// `Z` one reads in UTC. Never the viewer's time zone.
import type { TimestampPrecision } from "./types";

const TS_PARTS =
  /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/;

export type TakenParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  /** "Z", "+09:00"…; null for a time recorded without an offset. */
  offset: string | null;
  /** How much of it is public; a missing precision is "second". */
  precision: TimestampPrecision;
};

/** The timestamp's own fields (no time zone conversion); null if unreadable. */
export const takenParts = (
  timestamp: string | null | undefined,
  precision: TimestampPrecision | null | undefined,
): TakenParts | null => {
  const m = timestamp ? TS_PARTS.exec(timestamp) : null;
  if (!m) return null;
  return {
    year: m[1],
    month: m[2],
    day: m[3],
    hour: m[4],
    minute: m[5],
    offset: (m[6] as string | undefined) ?? null,
    precision: precision ?? "second",
  };
};

/** When a photo was taken: display text and a `<time datetime>` value. */
export type TakenAt = { text: string; datetime: string };

/**
 * 2023/12/16 23:12 (to the second or minute), 2023/12/16, 2023/12 or 2023:
 * as precisely as the API gives it. Null without a readable time.
 */
export const takenAt = (
  timestamp: string | null | undefined,
  precision: TimestampPrecision | null | undefined,
): TakenAt | null => {
  const p = takenParts(timestamp, precision);
  if (!p) return null;
  const { year: y, month: mo, day: d, hour: h, minute: mi } = p;
  switch (p.precision) {
    case "year":
      return { text: y, datetime: y };
    case "month":
      return { text: `${y}/${mo}`, datetime: `${y}-${mo}` };
    case "date":
      return { text: `${y}/${mo}/${d}`, datetime: `${y}-${mo}-${d}` };
    default:
      return {
        text: `${y}/${mo}/${d} ${h}:${mi}`,
        datetime: `${y}-${mo}-${d}T${h}:${mi}${p.offset ?? ""}`,
      };
  }
};

/**
 * The same in Japanese for sentences (og:description, titles): `day` is
 * 2023年12月16日 (or 2023年12月 / 2023年 when that is all that is public),
 * `full` adds the time when it is public: 2023年12月16日 23:12.
 */
export const takenJa = (
  timestamp: string | null | undefined,
  precision: TimestampPrecision | null | undefined,
): { day: string; full: string } | null => {
  const p = takenParts(timestamp, precision);
  if (!p) return null;
  const y = `${p.year}年`;
  const m = `${Number(p.month)}月`;
  const d = `${Number(p.day)}日`;
  switch (p.precision) {
    case "year":
      return { day: y, full: y };
    case "month":
      return { day: y + m, full: y + m };
    case "date":
      return { day: y + m + d, full: y + m + d };
    default:
      return { day: y + m + d, full: `${y}${m}${d} ${p.hour}:${p.minute}` };
  }
};
