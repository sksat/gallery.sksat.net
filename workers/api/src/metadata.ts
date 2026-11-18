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
