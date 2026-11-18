// A photo's shooting data on the edit page (covered by photo-data.spec.ts):
// camera settings (media.exif), the VRChat world and where it was taken.
// Read from the original at upload (photo-meta.ts) and editable by hand;
// an edit changes the row only, never the file.

import {
  EXIF_KEYS,
  MAX_META_TEXT,
  normalizeExif,
  type ExifJSON,
} from "./photo-meta";

/** The settings the edit page edits (orientation and the original time stay). */
export const EXIF_EDIT_KEYS = [
  "make",
  "model",
  "lens",
  "focal_length_mm",
  "f_number",
  "exposure_time",
  "iso",
] as const satisfies readonly (keyof ExifJSON)[];
export type ExifEditKey = (typeof EXIF_EDIT_KEYS)[number];

const NUMERIC: ReadonlySet<string> = new Set([
  "focal_length_mm",
  "f_number",
  "iso",
]);

export const EXIF_LABELS: Record<ExifEditKey, string> = {
  make: "メーカー",
  model: "機種",
  lens: "レンズ",
  focal_length_mm: "焦点距離 (mm)",
  f_number: "F 値",
  exposure_time: "シャッター速度 (秒)",
  iso: "ISO",
};

/** Parsed exif from the media.exif column (only the known keys). */
export const parseExifColumn = (raw: string | null | undefined): ExifJSON => {
  if (!raw) return {};
  try {
    return normalizeExif(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
};

const EXPOSURE_RE = /^(?:1\/\d{1,6}|\d{1,5}(?:\.\d{1,4})?)$/;

type Invalid = { ok: false; error: string };

/**
 * A text-or-number field of a request: undefined when absent (keep),
 * null when cleared (null or blank), the trimmed text otherwise. Anything
 * else (a boolean, an object) is refused rather than taken as a clear.
 */
const field = (
  x: unknown,
  name: string,
): { ok: true; value: string | null | undefined } | Invalid => {
  if (x === undefined) return { ok: true, value: undefined };
  if (x === null) return { ok: true, value: null };
  if (typeof x === "number") {
    return Number.isFinite(x)
      ? { ok: true, value: String(x) }
      : { ok: false, error: `${name} must be a finite number` };
  }
  if (typeof x !== "string") {
    return { ok: false, error: `${name} must be a string or number` };
  }
  const t = x.trim();
  return { ok: true, value: t === "" ? null : t };
};

/** A decimal as people write it ("35.6", "-139", "2.8"); no hex, no "1e3". */
const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

/** Edited camera settings: a value sets, null clears, a missing key keeps. */
export type ExifEdit = Partial<Record<ExifEditKey, string | number | null>>;

/**
 * The editable settings from a request: each key a string (form) or a
 * number; "" / null clears it, a key left out is kept. Unknown keys are
 * refused.
 */
export const validateExifEdit = (
  v: unknown,
): { ok: true; value: ExifEdit } | Invalid => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "exif must be an object" };
  }
  const out: ExifEdit = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!(EXIF_EDIT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `exif: unknown key ${key}` };
    }
    const k = key as ExifEditKey;
    const f = field(raw, `exif.${key}`);
    if (!f.ok) return f;
    if (f.value === undefined) continue;
    const t = f.value;
    if (t === null) {
      out[k] = null;
    } else if (NUMERIC.has(key)) {
      const n = Number(t);
      if (!DECIMAL_RE.test(t) || !(n > 0) || n > 1e6) {
        return { ok: false, error: `${EXIF_LABELS[k]}は正の数です` };
      }
      out[k] = key === "iso" ? Math.round(n) : n;
    } else if (key === "exposure_time") {
      if (!EXPOSURE_RE.test(t)) {
        return {
          ok: false,
          error: `${EXIF_LABELS.exposure_time}は 1/250 や 2 の形です`,
        };
      }
      out[k] = t;
    } else {
      if (t.length > MAX_META_TEXT) {
        return {
          ok: false,
          error: `${EXIF_LABELS[k]}は ${MAX_META_TEXT} 文字までです`,
        };
      }
      out[k] = t;
    }
  }
  return { ok: true, value: out };
};

/**
 * media.exif after an edit: the keys in `edit` are set (or cleared, when
 * null); every other key, including the ones the page never edits
 * (orientation, the original's time), is kept. Null when nothing is left.
 */
export const mergeExif = (
  currentRaw: string | null,
  edit: ExifEdit,
): string | null => {
  const current = parseExifColumn(currentRaw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EXIF_KEYS) {
    const v =
      key in edit ? (edit as Record<string, unknown>)[key] : current[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
};

export type LocationEdit = { latitude: number; longitude: number } | null;

/** Latitude and longitude from a request: both empty clears, both valid sets. */
export const validateLocationEdit = (
  v: unknown,
): { ok: true; value: LocationEdit } | Invalid => {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: "location must be an object or null" };
  }
  const o = v as Record<string, unknown>;
  const lat = field(o.latitude, "latitude");
  if (!lat.ok) return lat;
  const lon = field(o.longitude, "longitude");
  if (!lon.ok) return lon;
  // Both missing is not a clear: {} must not wipe a position.
  if (lat.value === undefined && lon.value === undefined) {
    return { ok: false, error: "location needs latitude and longitude" };
  }
  if (lat.value == null && lon.value == null) return { ok: true, value: null };
  const bad = {
    ok: false as const,
    error: "緯度は -90〜90、経度は -180〜180 の数を両方入れてください",
  };
  if (
    lat.value == null ||
    lon.value == null ||
    !DECIMAL_RE.test(lat.value) ||
    !DECIMAL_RE.test(lon.value)
  ) {
    return bad;
  }
  const latitude = Number(lat.value);
  const longitude = Number(lon.value);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return bad;
  return { ok: true, value: { latitude, longitude } };
};

/** The world: a value sets, null clears, undefined keeps. */
export type WorldEdit = { id?: string | null; name?: string | null };

const WORLD_ID_RE = /^wrld_[0-9A-Za-z-]+$/;

/** The world's id and name from a request, each optional. */
export const validateWorldEdit = (
  v: unknown,
): { ok: true; value: WorldEdit } | Invalid => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "world must be an object" };
  }
  const o = v as Record<string, unknown>;
  const id = field(o.id, "world_id");
  if (!id.ok) return id;
  const name = field(o.name, "world_name");
  if (!name.ok) return name;
  if (typeof id.value === "string" && !WORLD_ID_RE.test(id.value)) {
    return { ok: false, error: "ワールド ID は wrld_… の形です" };
  }
  if (typeof name.value === "string" && name.value.length > MAX_META_TEXT) {
    return {
      ok: false,
      error: `ワールド名は ${MAX_META_TEXT} 文字までです`,
    };
  }
  const out: WorldEdit = {};
  if (id.value !== undefined) out.id = id.value;
  if (name.value !== undefined) out.name = name.value;
  return { ok: true, value: out };
};

/**
 * The edit form's shooting data, as compared to decide what changed: each
 * group's fields as submitted, trimmed. The page sends the same for the
 * values it was loaded with, so a group is written only when edited (a
 * stale page must not clear what was read from the file since).
 */
export const formGroups = (
  get: (name: string) => string | undefined,
): PhotoDataGroups => {
  // As a text input holds it: no line breaks.
  const v = (name: string) => (get(name) ?? "").replace(/[\r\n]/g, "").trim();
  return {
    exif: JSON.stringify(EXIF_EDIT_KEYS.map((k) => v(`exif_${k}`))),
    location: JSON.stringify(["latitude", "longitude"].map(v)),
    world: JSON.stringify(["world_id", "world_name"].map(v)),
  };
};

export type PhotoDataGroups = { exif: string; location: string; world: string };

/** The groups that differ between the loaded form and the submitted one. */
export const changedGroups = (
  loaded: PhotoDataGroups,
  submitted: PhotoDataGroups,
): (keyof PhotoDataGroups)[] =>
  (["exif", "location", "world"] as const).filter(
    (g) => loaded[g] !== submitted[g],
  );

/** The form values a row is shown with (the inputs' initial values). */
export const rowFormValues = (row: {
  exif: ExifJSON;
  latitude: number | null;
  longitude: number | null;
  world_id: string | null;
  world_name: string | null;
}): Record<string, string> => {
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return {
    ...Object.fromEntries(
      EXIF_EDIT_KEYS.map((k) => [`exif_${k}`, s(row.exif[k])]),
    ),
    latitude: s(row.latitude),
    longitude: s(row.longitude),
    world_id: s(row.world_id),
    world_name: s(row.world_name),
  };
};

/** "FUJIFILM X-T5 · XF35mmF1.4 R" */
export const formatGear = (e: ExifJSON): string =>
  [[e.make, e.model].filter(Boolean).join(" "), e.lens]
    .filter(Boolean)
    .join(" · ");

/** "35mm · f/2.8 · 1/250 秒 · ISO 400" */
export const formatExposureLine = (e: ExifJSON): string =>
  [
    e.focal_length_mm !== undefined && `${e.focal_length_mm}mm`,
    e.f_number !== undefined && `f/${e.f_number}`,
    e.exposure_time !== undefined && `${e.exposure_time} 秒`,
    e.iso !== undefined && `ISO ${e.iso}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** The world's page on vrchat.com. */
export const worldUrl = (id: string): string =>
  `https://vrchat.com/home/world/${encodeURIComponent(id)}`;

/** OpenStreetMap at a point (until the map preview). */
export const mapUrl = (latitude: number, longitude: number): string =>
  `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
