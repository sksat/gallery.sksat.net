// How much of each piece of a photo's metadata the public site may show
// (admin migration 0005). Every field has ordered levels, most to least.
// The site-wide defaults are the `setting` row `metadata_visibility`; a
// photo may override any field in `media.metadata_visibility`. Both are
// JSON objects of field → level; a missing field falls through (photo →
// site → BUILTIN_DEFAULTS), and a value that is not one of the field's
// levels counts as "hidden", the same as the SQL in query.ts (levelSql).
//
// The admin keeps a copy of the field and level lists for its forms
// (admin/src/lib/metadata.ts; metadata.spec.ts checks they match).

export const METADATA_LEVELS = {
  /** path: folder + name; name: the name only. */
  file_name: ["path", "name", "hidden"],
  /** How precisely the time it was taken is shown. */
  taken_at: ["second", "minute", "date", "month", "year", "hidden"],
  /** model: the camera (with its page); manufacturer: the maker only. */
  camera: ["model", "manufacturer", "hidden"],
  /** public: the tags marked public in the `tag` table. */
  tags: ["public", "hidden"],
  // Reserved: no data yet, nothing is returned for them.
  location: ["exact", "city", "prefecture", "country", "hidden"],
  world: ["link", "name", "hidden"],
  exif: ["all", "basic", "hidden"],
} as const;

export type MetadataField = keyof typeof METADATA_LEVELS;
export type MetadataLevels = {
  [F in MetadataField]: (typeof METADATA_LEVELS)[F][number];
};

export const METADATA_FIELDS = Object.keys(METADATA_LEVELS) as MetadataField[];

/**
 * Used when neither the photo nor the site says anything. The first four
 * keep what the public site showed before 0005, apart from the file name
 * (the owner hides it by default).
 */
export const BUILTIN_DEFAULTS: MetadataLevels = {
  file_name: "hidden",
  taken_at: "second",
  camera: "model",
  tags: "public",
  location: "hidden",
  world: "link",
  exif: "basic",
};

export const isLevel = <F extends MetadataField>(
  field: F,
  v: unknown,
): v is MetadataLevels[F] =>
  (METADATA_LEVELS[field] as readonly unknown[]).includes(v);

const parseObject = (raw: string | null | undefined) => {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/**
 * Each field's level for one photo: its own override, else the site's
 * default, else BUILTIN_DEFAULTS. A value that is set but not a level of
 * its field is "hidden" (fail closed).
 */
export const effectiveLevels = (
  siteRaw: string | null | undefined,
  photoRaw: string | null | undefined,
): MetadataLevels => {
  const site = parseObject(siteRaw);
  const photo = parseObject(photoRaw);
  const out = { ...BUILTIN_DEFAULTS } as Record<MetadataField, string>;
  for (const field of METADATA_FIELDS) {
    const v = photo[field] ?? site[field];
    if (v === undefined || v === null) continue;
    out[field] = isLevel(field, v) ? (v as string) : "hidden";
  }
  return out as MetadataLevels;
};

const TS_RE =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/;

/**
 * The time a photo was taken at a level: cut down in the photo's own
 * offset (a JST photo stays on its JST date), keeping the offset, so it
 * is still an ISO timestamp. "second" is the value as recorded. Null when
 * hidden, or when the value cannot be read for a coarser level.
 */
export const truncateTimestamp = (
  ts: string | null,
  level: MetadataLevels["taken_at"],
): string | null => {
  if (ts === null || level === "hidden") return null;
  if (level === "second") return ts;
  const m = TS_RE.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, , off] = m;
  switch (level) {
    case "minute":
      return `${y}-${mo}-${d}T${h}:${mi}:00${off}`;
    case "date":
      return `${y}-${mo}-${d}T00:00:00${off}`;
    case "month":
      return `${y}-${mo}-01T00:00:00${off}`;
    case "year":
      return `${y}-01-01T00:00:00${off}`;
  }
};

/** Decimals kept at each location level (about 1 m, 1 km, 10 km, 100 km). */
const LOCATION_DECIMALS = { exact: 5, city: 2, prefecture: 1, country: 0 };

/**
 * Where a photo was taken at a level: rounded to that level's decimals.
 * "city", "prefecture" and "country" give only a coarse position for now
 * (no place name: reverse geocoding comes later). Null when hidden or
 * unknown (both coordinates are needed).
 */
export const locationAt = (
  latitude: number | null,
  longitude: number | null,
  level: MetadataLevels["location"],
): {
  latitude: number;
  longitude: number;
  precision: Exclude<MetadataLevels["location"], "hidden">;
} | null => {
  if (level === "hidden" || latitude === null || longitude === null) {
    return null;
  }
  const f = 10 ** LOCATION_DECIMALS[level];
  // + 0 turns -0 into 0.
  const round = (v: number) => Math.round(v * f) / f + 0;
  return {
    latitude: round(latitude),
    longitude: round(longitude),
    precision: level,
  };
};

/**
 * media.exif: the camera settings of a photo, normalized (whatever wrote
 * it, from EXIF or XMP). Every key is optional.
 */
export type ExifJSON = {
  make?: string;
  model?: string;
  lens?: string;
  focal_length_mm?: number;
  f_number?: number;
  /** As photographers write it: "1/250", "2", "0.5". */
  exposure_time?: string;
  iso?: number;
  /** EXIF Orientation, 1–8. */
  orientation?: number;
  /** DateTimeOriginal, as ISO 8601 when it has an offset. */
  taken_at_original?: string;
};

const EXIF_TYPES = {
  make: "string",
  model: "string",
  lens: "string",
  focal_length_mm: "number",
  f_number: "number",
  exposure_time: "string",
  iso: "number",
  orientation: "number",
  taken_at_original: "string",
} as const satisfies Record<keyof ExifJSON, "string" | "number">;

export const EXIF_KEYS = Object.keys(EXIF_TYPES) as (keyof ExifJSON)[];

/** The `basic` exif level: how it was exposed. */
export const BASIC_EXIF_KEYS: readonly (keyof ExifJSON)[] = [
  "f_number",
  "exposure_time",
  "iso",
  "focal_length_mm",
];

/**
 * media.exif read leniently: only the known keys, each of its type (finite
 * numbers, non-empty strings). Anything else is dropped.
 */
export const parseExif = (raw: string | null | undefined): ExifJSON => {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, string | number> = {};
  for (const key of EXIF_KEYS) {
    const value = (v as Record<string, unknown>)[key];
    if (EXIF_TYPES[key] === "number") {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = value;
      }
    } else if (typeof value === "string" && value !== "") {
      out[key] = value;
    }
  }
  return out as ExifJSON;
};

/** The camera settings at a level; null when hidden or nothing is known. */
export const exifAt = (
  raw: string | null | undefined,
  level: MetadataLevels["exif"],
): ExifJSON | null => {
  if (level === "hidden") return null;
  const exif = parseExif(raw);
  const keys = level === "basic" ? BASIC_EXIF_KEYS : EXIF_KEYS;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (exif[key] !== undefined) out[key] = exif[key];
  return Object.keys(out).length > 0 ? (out as ExifJSON) : null;
};

/**
 * The VRChat world it was taken in, at a level: "link" gives the id too
 * (https://vrchat.com/home/world/<id>), "name" the name only. Null when
 * hidden or unknown. (The world's author is never public.)
 */
export const worldAt = (
  id: string | null,
  name: string | null,
  level: MetadataLevels["world"],
): { id?: string; name: string | null } | null => {
  if (level === "hidden") return null;
  if (level === "name") return name ? { name } : null;
  if (!id && !name) return null;
  return { ...(id ? { id } : {}), name };
};
