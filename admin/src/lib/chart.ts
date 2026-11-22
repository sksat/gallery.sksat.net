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

/**
 * Indexes of the buckets that get an axis label: every one up to 7, else
 * every 6th (hours) or 7th (days), counted back from the newest so the
 * latest bucket is always labelled.
 */
export const labelledIndexes = (n: number, hourly: boolean): number[] => {
  const step = n <= 7 ? 1 : hourly ? 6 : 7;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
};

const JST_MS = 9 * 3600_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * Bucket keys are UTC: "2026-11-18" (a UTC day) or "2026-11-18T03" (an
 * hour). Days are shown as they are; hours in JST, like the rest of the
 * admin.
 */
const hourJst = (key: string): Date =>
  new Date(Date.parse(`${key.slice(0, 13)}:00:00Z`) + JST_MS);

/** Short axis label: "11/18", or the hour "12時" (JST). */
export const bucketAxisLabel = (key: string): string => {
  if (key.length > 10) return `${hourJst(key).getUTCHours()}時`;
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
};

/** Tooltip heading: "11/18 (水)", or "11/18 12:00–13:00" (JST). */
export const bucketTitle = (key: string): string => {
  if (key.length > 10) {
    const d = hourJst(key);
    const h = d.getUTCHours();
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${h}:00–${h + 1}:00`;
  }
  const d = new Date(`${key}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAYS[d.getUTCDay()]})`;
};

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
