/**
 * The edit page's 撮影日時 input (`<input type="datetime-local">`) and
 * media.timestamp (ISO 8601 with an offset). The input shows the time in
 * the photo's own offset, and a typed time keeps that offset, so editing
 * never shifts a photo to another zone. A time stored in UTC ("Z", old
 * rows) or with no offset is shown and kept in JST, as the rest of the
 * admin shows times.
 */

const TS_RE =
  /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(?::(\d\d))?(?:\.\d+)?(Z|[+-]\d\d:\d\d)?$/;

const JST = "+09:00";

/** The offset a typed time is in: the photo's own, JST for UTC or none. */
export const takenAtOffset = (ts: string | null): string => {
  const off = ts ? TS_RE.exec(ts)?.[3] : undefined;
  return off === undefined || off === "Z" || off === "+00:00" ? JST : off;
};

/**
 * The input's value for a timestamp ("" when none or unreadable), in its
 * offset (takenAtOffset) and in the form the browser gives it back
 * (seconds left out when zero), so an untouched input reads as unchanged.
 */
export const takenAtInputValue = (ts: string | null): string => {
  const m = ts ? TS_RE.exec(ts) : null;
  if (!m) return "";
  let [, minute, second = "00"] = m;
  const off = m[3];
  if (off === "Z" || off === "+00:00") {
    // To JST: nine hours on, as the wall clock there reads.
    const ms = Date.parse(`${minute}:${second}Z`) + 9 * 3600_000;
    const jst = new Date(ms).toISOString();
    minute = jst.slice(0, 16);
    second = jst.slice(17, 19);
  }
  return second !== "00" ? `${minute}:${second}` : minute;
};

/**
 * The timestamp for what was typed: null for an empty input, undefined
 * when it cannot be read (the form then reports it).
 */
export const takenAtFromInput = (
  value: string,
  offset: string,
): string | null | undefined => {
  const v = value.trim();
  if (v === "") return null;
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(?::(\d\d))?$/.exec(v);
  if (!m || !/^[+-]\d\d:\d\d$/.test(offset)) return undefined;
  return `${m[1]}:${m[2] ?? "00"}${offset}`;
};
