// Changing the information of several photos at once (the Files view's
// タグと撮影データ sheet; pure, bulk-info.spec.ts): tags added or removed,
// the time taken, the VRChat world, the position and the shooting
// settings. Only what was touched is part of an edit; each photo keeps
// everything else. The same validators as the single edit page check
// every value.
//
// TODO(metadata_source): once migration 0008 (media.metadata_source, PR
// #200) is on main, mark each field written here as 'manual' in
// `applyInfo` (the position already is, through location_source).

import { storedOverrides } from "./bulk-metadata";
import { parseOverrides } from "./metadata";
import {
  mergeExif,
  parseExifColumn,
  validateExifEdit,
  validateLocationEdit,
  validateWorldEdit,
  type ExifEdit,
  type LocationEdit,
  type WorldEdit,
} from "./photo-data";
import type { ExifJSON } from "./photo-meta";
import { validatePatch } from "./validate";

/** "Each photo as it is", for a part of the time taken. */
export const KEEP = "keep";

/**
 * The time taken. Each part is a value or KEEP (each photo's own). `time`
 * null is the date alone (e.g. a film roll), which the public site then
 * shows as a date only. A photo with no time yet gets one only when the
 * date is given (its time then is none unless given too).
 */
export type TakenAtEdit = {
  /** YYYY-MM-DD, or KEEP. */
  date: string;
  /** HH:MM or HH:MM:SS, null for none, or KEEP. */
  time: string | null;
  /** +HH:MM / -HH:MM / Z, or KEEP (JST for a photo that has none). */
  offset: string;
};

export type InfoEdit = {
  tagsAdd?: string[];
  tagsRemove?: string[];
  takenAt?: TakenAtEdit;
  world?: WorldEdit;
  location?: LocationEdit;
  exif?: ExifEdit;
};

/** The columns an edit can touch, as stored (also what an undo restores). */
export type InfoRow = {
  id: number;
  tags: string;
  timestamp: string | null;
  metadata_visibility: string | null;
  world_id: string | null;
  world_name: string | null;
  world_author_id: string | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  exif: string | null;
};

/** A selected photo's values, as the sheet shows them. */
export type InfoValues = {
  id: number;
  tags: string[];
  timestamp: string | null;
  world_id: string | null;
  world_name: string | null;
  latitude: number | null;
  longitude: number | null;
  exif: ExifJSON;
};

type Invalid = { ok: false; error: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const OFFSET_RE = /^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
/** A stored time: its date, time of day and offset (if any). */
const STORED_RE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const DEFAULT_OFFSET = "+09:00";
const AUTHOR_RE = /^usr_[0-9A-Za-z-]{1,100}$/;

const validDate = (s: string) => {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
};

const validateTakenAt = (
  v: unknown,
): { ok: true; value: TakenAtEdit } | Invalid => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "takenAt must be an object" };
  }
  const o = v as Record<string, unknown>;
  const date = o.date ?? KEEP;
  if (typeof date !== "string" || (date !== KEEP && !validDate(date))) {
    return { ok: false, error: "撮影日は YYYY-MM-DD の日付です" };
  }
  const time = o.time === undefined ? KEEP : o.time;
  if (
    time !== null &&
    (typeof time !== "string" || (time !== KEEP && !TIME_RE.test(time)))
  ) {
    return { ok: false, error: "時刻は HH:MM です" };
  }
  const offset = o.offset ?? KEEP;
  if (
    typeof offset !== "string" ||
    (offset !== KEEP && !OFFSET_RE.test(offset))
  ) {
    return { ok: false, error: "時差は +09:00 の形です" };
  }
  if (date === KEEP && time === KEEP && offset === KEEP) {
    return { ok: false, error: "takenAt changes nothing" };
  }
  return { ok: true, value: { date, time, offset } };
};

const tagList = (v: unknown, name: string) => {
  const r = validatePatch({ tags: v });
  return r.ok
    ? { ok: true as const, value: r.patch.tags ?? [] }
    : { ok: false as const, error: `${name}: ${r.error}` };
};

const EDIT_KEYS = [
  "tagsAdd",
  "tagsRemove",
  "takenAt",
  "world",
  "location",
  "exif",
];

/** An edit from a request; nothing touched is an error. */
export const validateInfoEdit = (
  v: unknown,
): { ok: true; value: InfoEdit } | Invalid => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "edit must be an object" };
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!EDIT_KEYS.includes(k)) {
      return { ok: false, error: `unknown field ${k}` };
    }
  }
  const out: InfoEdit = {};
  if (o.tagsAdd !== undefined) {
    const r = tagList(o.tagsAdd, "tagsAdd");
    if (!r.ok) return r;
    if (r.value.length > 0) out.tagsAdd = r.value;
  }
  if (o.tagsRemove !== undefined) {
    const r = tagList(o.tagsRemove, "tagsRemove");
    if (!r.ok) return r;
    if (r.value.length > 0) out.tagsRemove = r.value;
  }
  if (o.takenAt !== undefined) {
    const r = validateTakenAt(o.takenAt);
    if (!r.ok) return r;
    out.takenAt = r.value;
  }
  if (o.world !== undefined) {
    const r = validateWorldEdit(o.world);
    if (!r.ok) return r;
    if (Object.keys(r.value).length > 0) out.world = r.value;
  }
  if (o.location !== undefined) {
    const r = validateLocationEdit(o.location);
    if (!r.ok) return r;
    out.location = r.value;
  }
  if (o.exif !== undefined) {
    const r = validateExifEdit(o.exif);
    if (!r.ok) return r;
    if (Object.keys(r.value).length > 0) out.exif = r.value;
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: "nothing to change" };
  }
  return { ok: true, value: out };
};

export const parseTags = (raw: string | null): string[] => {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
};

/** A photo's tags with `add` appended (in order) and `remove` taken out. */
export const editTags = (
  tags: readonly string[],
  add: readonly string[] = [],
  remove: readonly string[] = [],
): string[] => {
  const drop = new Set(remove);
  const out = tags.filter((t) => !drop.has(t));
  for (const t of add) if (!drop.has(t) && !out.includes(t)) out.push(t);
  return out;
};

/** A stored time's parts, as written (its own offset, not converted). */
export const timeParts = (
  stored: string | null,
): { date: string; time: string | null; offset: string | null } | null => {
  const m = STORED_RE.exec(stored ?? "");
  if (!m) return null;
  const off = m[3] ?? null;
  return {
    date: m[1],
    time: m[2] ?? null,
    offset:
      off && off !== "Z" && !off.includes(":")
        ? `${off.slice(0, 3)}:${off.slice(3)}`
        : off,
  };
};

/**
 * The stored time for `edit` on a photo taken at `current`, and whether it
 * has a time of day; null when the photo keeps having none.
 */
export const takenAtFor = (
  current: string | null,
  edit: TakenAtEdit,
): { timestamp: string; withTime: boolean } | null => {
  const parts = timeParts(current);
  const date = edit.date === KEEP ? parts?.date : edit.date;
  if (!date) return null;
  const time = edit.time === KEEP ? (parts?.time ?? null) : edit.time;
  const offset =
    edit.offset === KEEP ? (parts?.offset ?? DEFAULT_OFFSET) : edit.offset;
  const hms = time === null ? "00:00:00" : time.length === 5 ? `${time}:00` : time;
  return { timestamp: `${date}T${hms}${offset}`, withTime: time !== null };
};

/**
 * A photo's columns after `edit` (nothing else changes). A date alone also
 * makes the public site show the date only (the photo's 撮影日時 level).
 */
export const applyInfo = (row: InfoRow, edit: InfoEdit): InfoRow => {
  const out = { ...row };
  if (edit.tagsAdd || edit.tagsRemove) {
    const before = parseTags(row.tags);
    const after = editTags(before, edit.tagsAdd, edit.tagsRemove);
    // As stored when nothing changed (the JSON may be spelled otherwise).
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      out.tags = JSON.stringify(after);
    }
  }
  if (edit.takenAt) {
    const t = takenAtFor(row.timestamp, edit.takenAt);
    if (t) {
      out.timestamp = t.timestamp;
      // No time of day (given as none, or kept from a photo that had none),
      // also when the stored time stays (already that date at midnight).
      if (!t.withTime) {
        out.metadata_visibility = storedOverrides({
          ...parseOverrides(row.metadata_visibility),
          taken_at: "date",
        });
      }
    }
  }
  if (edit.world) {
    if (edit.world.id !== undefined) {
      // The author read from the file belongs to that world only.
      if (edit.world.id !== row.world_id) out.world_author_id = null;
      out.world_id = edit.world.id;
    }
    if (edit.world.name !== undefined) out.world_name = edit.world.name;
  }
  if (edit.location !== undefined) {
    const lat = edit.location?.latitude ?? null;
    const lon = edit.location?.longitude ?? null;
    if (lat !== row.latitude || lon !== row.longitude) {
      out.latitude = lat;
      out.longitude = lon;
      out.location_source = lat === null ? null : "manual";
    }
  }
  if (edit.exif) {
    const merged = mergeExif(row.exif, edit.exif);
    // As stored when the values are the same.
    if (merged !== mergeExif(row.exif, {})) out.exif = merged;
  }
  return out;
};

export const INFO_COLUMNS = [
  "tags",
  "timestamp",
  "metadata_visibility",
  "world_id",
  "world_name",
  "world_author_id",
  "latitude",
  "longitude",
  "location_source",
  "exif",
] as const satisfies readonly (keyof InfoRow)[];

/**
 * Why a photo cannot take the edit (e.g. more tags than one photo may
 * have, as the edit page checks), or null.
 */
export const infoProblem = (after: InfoRow): string | null => {
  const r = validatePatch({ tags: parseTags(after.tags) });
  return r.ok ? null : r.error;
};

/** Whether `edit` changed anything stored. */
export const infoChanged = (before: InfoRow, after: InfoRow): boolean =>
  INFO_COLUMNS.some((c) => before[c] !== after[c]);

/** A stored row as the sheet shows it. */
export const infoValues = (row: InfoRow): InfoValues => ({
  id: row.id,
  tags: parseTags(row.tags),
  timestamp: row.timestamp,
  world_id: row.world_id,
  world_name: row.world_name,
  latitude: row.latitude,
  longitude: row.longitude,
  exif: parseExifColumn(row.exif),
});

const optText = (v: unknown, max: number): string | null | undefined =>
  v === null
    ? null
    : typeof v === "string" && v.length <= max
      ? v
      : undefined;

const optNumber = (v: unknown, limit: number): number | null | undefined =>
  v === null
    ? null
    : typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit
      ? v
      : undefined;

/**
 * An undo from a request: each photo's columns as setInfo returned them.
 * Every value is checked and written back in its stored form; a row with
 * anything else is refused.
 */
export const validateInfoRestore = (
  v: unknown,
  maxRows: number,
): { ok: true; rows: InfoRow[] } | Invalid => {
  if (!Array.isArray(v) || v.length > maxRows) {
    return { ok: false, error: `at most ${maxRows} photos at a time` };
  }
  const rows: InfoRow[] = [];
  const seen = new Set<number>();
  for (const raw of v) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const bad = { ok: false as const, error: "invalid row" };
    if (!Number.isSafeInteger(o.id) || (o.id as number) <= 0) return bad;
    if (seen.has(o.id as number)) continue;
    seen.add(o.id as number);
    const tags = validatePatch({ tags: parseTags(String(o.tags ?? "")) });
    const timestamp = optText(o.timestamp, 40);
    const world = validateWorldEdit({ id: o.world_id, name: o.world_name });
    const author = optText(o.world_author_id, 110);
    const lat = optNumber(o.latitude, 90);
    const lon = optNumber(o.longitude, 180);
    const source = o.location_source;
    const mv = optText(o.metadata_visibility, 1000);
    const exif = optText(o.exif, 10_000);
    if (
      !tags.ok ||
      timestamp === undefined ||
      (timestamp !== null && !timeParts(timestamp)) ||
      !world.ok ||
      !("world_id" in o && "world_name" in o) ||
      author === undefined ||
      (author !== null && !AUTHOR_RE.test(author)) ||
      lat === undefined ||
      lon === undefined ||
      (lat === null) !== (lon === null) ||
      !(source === null || source === "exif" || source === "manual") ||
      mv === undefined ||
      exif === undefined
    ) {
      return bad;
    }
    rows.push({
      id: o.id as number,
      tags: JSON.stringify(tags.patch.tags ?? []),
      timestamp,
      metadata_visibility: storedOverrides(parseOverrides(mv)),
      world_id: world.value.id ?? null,
      world_name: world.value.name ?? null,
      world_author_id: author,
      latitude: lat,
      longitude: lon,
      location_source: lat === null ? null : (source as string | null),
      exif: mergeExif(exif, {}),
    });
  }
  return { ok: true, rows };
};

export type TagState = "all" | "some" | "none";

/**
 * For each tag of the selected photos: whether all, some or none of them
 * have it, with the count, in the order first seen.
 */
export const tagCounts = (
  photos: readonly { tags: readonly string[] }[],
): { tag: string; count: number; state: TagState }[] => {
  const counts = new Map<string, number>();
  for (const p of photos) {
    for (const t of new Set(p.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({
    tag,
    count,
    state: count === photos.length ? "all" : "some",
  }));
};

/** A tag's next state on a click: some → all → none → some (as it was). */
export const nextTagState = (now: TagState, initial: TagState): TagState =>
  now === "all"
    ? "none"
    : now === "none"
      ? initial === "some"
        ? "some"
        : "all"
      : "all";

/** The tags to add and remove for states changed from what they were. */
export const tagChanges = (
  tags: readonly { tag: string; initial: TagState; now: TagState }[],
): { tagsAdd: string[]; tagsRemove: string[] } => ({
  tagsAdd: tags
    .filter((t) => t.now === "all" && t.initial !== "all")
    .map((t) => t.tag),
  tagsRemove: tags
    .filter((t) => t.now === "none" && t.initial !== "none")
    .map((t) => t.tag),
});

/** The value every photo has, or undefined when they differ (or none). */
export const shared = <T>(values: readonly T[]): T | undefined => {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
};
