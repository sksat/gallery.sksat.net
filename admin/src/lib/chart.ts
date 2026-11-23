// Pure helpers for the access charts (components/column-chart.tsx): the
// value axis, which buckets get an axis label, bucket names and the
// change against the previous period.

/**
 * A value axis from 0 with 2–4 clean steps (1, 2 or 5 × 10^k) whose top
 * is at or above `max`. No data (max 0) still draws one step.
 */
export const niceScale = (max: number): { top: number; ticks: number[] } => {
  const m = Math.max(0, max);
  if (m === 0) return { top: 1, ticks: [0, 1] };
  const rough = m / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= rough) ?? 10 * pow;
  // Counts are whole: never a step below 1.
  const s = Math.max(1, step);
  const top = Math.ceil(m / s) * s;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += s) ticks.push(t);
  return { top, ticks };
};

const JST_MS = 9 * 3600_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * Bucket keys (web-analytics.ts): "2026-11-18" is a JST day, shown as it
 * is; "2026-11-18T03" a UTC hour, shown in JST like the rest of the admin.
 * Both as a Date whose UTC fields are the JST ones.
 */
const hourJst = (key: string): Date =>
  new Date(Date.parse(`${key.slice(0, 13)}:00:00Z`) + JST_MS);
const dayOf = (key: string): Date =>
  key.length > 10 ? hourJst(key) : new Date(`${key}T00:00:00Z`);

/** "11/18 (水)" of a Date in JST fields. */
const dayName = (d: Date): string =>
  `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAYS[d.getUTCDay()]})`;

/** Short axis label: "11/18", or the hour "12時" (JST). */
export const bucketAxisLabel = (key: string): string => {
  if (key.length > 10) return `${hourJst(key).getUTCHours()}時`;
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
};

export type AxisTick = { index: number; label: string };

/**
 * The time axis of a run of bucket keys, oldest first:
 * - hours: a tick at every 6th JST hour ("0時", "6時", "12時", "18時"),
 *   and a day label ("11/23 (月)") under the first bucket and at each
 *   midnight, where the chart also draws a line. The first bucket's day
 *   is left out when a midnight follows within 4 hours (they would
 *   overlap).
 * - days: every day up to 7, else every 7th day counted back from the
 *   newest (so today is always labelled), as "11/23"; no day labels.
 */
export const timeAxis = (
  keys: string[],
): { ticks: AxisTick[]; days: AxisTick[] } => {
  const n = keys.length;
  if (n === 0 || keys[0].length <= 10) {
    const step = n <= 7 ? 1 : 7;
    const ticks: AxisTick[] = [];
    for (let i = n - 1; i >= 0; i -= step) {
      ticks.unshift({ index: i, label: bucketAxisLabel(keys[i]) });
    }
    return { ticks, days: [] };
  }
  const ticks: AxisTick[] = [];
  const days: AxisTick[] = [];
  keys.forEach((key, index) => {
    const d = hourJst(key);
    const h = d.getUTCHours();
    if (h % 6 === 0) ticks.push({ index, label: `${h}時` });
    if (h === 0 && index > 0) days.push({ index, label: dayName(d) });
  });
  if (!(days.length > 0 && days[0].index < 4)) {
    days.unshift({ index: 0, label: dayName(hourJst(keys[0])) });
  }
  return { ticks, days };
};

/**
 * Tooltip heading, the bucket's whole span in JST: "11/18 (水)", or
 * "11/18 (水) 12:00–13:00" for an hour.
 */
export const bucketTitle = (key: string): string => {
  const d = dayOf(key);
  if (key.length <= 10) return dayName(d);
  const h = d.getUTCHours();
  return `${dayName(d)} ${h}:00–${h + 1}:00`;
};

/**
 * What the note under a chart calls its newest bucket, which is still
 * filling: "14時台" for an hour, "今日" for a day.
 */
export const currentBucketName = (key: string): string =>
  key.length > 10 ? `${hourJst(key).getUTCHours()}時台` : "今日";

/** "+12%", "−8%" (a real minus sign) or "±0%". */
export const formatChange = (ratio: number): string => {
  const pct = Math.round(ratio * 100);
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : "±0%";
};

/** The direction of a change, after the same rounding as formatChange. */
export const changeDirection = (ratio: number): "up" | "down" | "flat" => {
  const pct = Math.round(ratio * 100);
  return pct > 0 ? "up" : pct < 0 ? "down" : "flat";
};
