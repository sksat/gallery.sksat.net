// Presentation helpers shared by the admin routes. Pure functions only so
// they stay covered by Vitest (see format.spec.ts).

/** Split a media path into its folder (with trailing slash) and basename. */
export const splitPath = (file: string): { dir: string; base: string } => {
  const i = file.lastIndexOf("/");
  return { dir: file.slice(0, i + 1), base: file.slice(i + 1) };
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Format an ISO timestamp as `YYYY/MM/DD HH:mm` in JST (UTC+9, no DST).
 * Done by hand rather than via `Intl` so the output does not depend on the
 * runtime's ICU data (workerd vs Node vs the browser).
 * Returns null for a missing value and the input unchanged if unparseable.
 */
export const formatJst = (ts: string | null): string | null => {
  if (!ts) return null;
  // Date.parse is lenient (V8 accepts "sometime in 2023") and reads an
  // offset-less date-time as runtime-local time; only trust ISO 8601
  // date-times that carry an explicit offset.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(ts)) {
    return ts;
  }
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts;
  const d = new Date(ms + JST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
};

/** URL of a /media list page, omitting defaults (no filter, page 1). */
export const mediaListHref = (opts: {
  world?: string | null;
  q?: string | null;
  page?: number;
}): string => {
  const params = new URLSearchParams();
  if (opts.world) params.set("world", opts.world);
  if (opts.q) params.set("q", opts.q);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  const s = params.toString();
  return s ? `/media/?${s}` : "/media/";
};

/** Number of the last page (1-based); 1 when there are no rows. */
export const lastPage = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize));
