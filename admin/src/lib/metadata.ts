// How much of a photo's metadata the public site shows (migration 0005):
// the admin's copy of the field and level lists in
// workers/api/src/metadata.ts, which applies them (its metadata.spec.ts
// checks the two match), plus the labels of the admin's controls.

export const METADATA_LEVELS = {
  file_name: ["path", "name", "hidden"],
  taken_at: ["second", "minute", "date", "month", "year", "hidden"],
  camera: ["model", "manufacturer", "hidden"],
  tags: ["public", "hidden"],
  // Reserved: no data yet.
  location: ["exact", "city", "prefecture", "country", "hidden"],
  world: ["link", "name", "hidden"],
  exif: ["all", "basic", "hidden"],
  /** 0009: the device it was digitised with (media.digitized_with). */
  digitizer: ["model", "manufacturer", "hidden"],
  /** 0009: when it was digitised (media.digitized_at). */
  digitized_at: ["second", "minute", "date", "month", "year", "hidden"],
} as const;

export type MetadataField = keyof typeof METADATA_LEVELS;
export type MetadataLevels = {
  [F in MetadataField]: (typeof METADATA_LEVELS)[F][number];
};
/** A photo's overrides: only the fields it sets. */
export type MetadataOverrides = Partial<MetadataLevels>;

export const BUILTIN_DEFAULTS: MetadataLevels = {
  file_name: "hidden",
  taken_at: "second",
  camera: "model",
  tags: "public",
  location: "hidden",
  world: "link",
  exif: "basic",
  digitizer: "hidden",
  digitized_at: "hidden",
};

/** Every field has a control, in this order. */
export const EDITABLE_FIELDS = [
  "file_name",
  "taken_at",
  "camera",
  "digitizer",
  "digitized_at",
  "tags",
  "exif",
  "world",
  "location",
] as const satisfies readonly MetadataField[];
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * The fields read from the file: on the edit page their level sits next
 * to their value (撮影データ), the others under 公開する情報.
 */
export const FILE_DATA_FIELDS = [
  "exif",
  "world",
  "location",
] as const satisfies readonly EditableField[];

export const FIELD_LABELS: Record<EditableField, string> = {
  file_name: "ファイル名",
  taken_at: "撮影日時",
  camera: "カメラ",
  digitizer: "スキャン機材",
  digitized_at: "スキャン日時",
  tags: "タグ",
  exif: "撮影設定",
  world: "ワールド",
  location: "撮影場所",
};

/**
 * Whether served images carry the public information as EXIF (setting
 * embed_exif, media.embed_exif; 0009).
 */
export const EMBED_LABEL = "画像に EXIF を付ける";

export const LEVEL_LABELS: {
  [F in EditableField]: Record<MetadataLevels[F], string>;
} = {
  file_name: {
    path: "フォルダとファイル名",
    name: "ファイル名だけ",
    hidden: "出さない",
  },
  taken_at: {
    second: "秒まで",
    minute: "分まで",
    date: "日付まで",
    month: "年月まで",
    year: "年だけ",
    hidden: "出さない",
  },
  camera: {
    model: "機種まで",
    manufacturer: "メーカーだけ",
    hidden: "出さない",
  },
  digitizer: {
    model: "機種まで",
    manufacturer: "メーカーだけ",
    hidden: "出さない",
  },
  digitized_at: {
    second: "秒まで",
    minute: "分まで",
    date: "日付まで",
    month: "年月まで",
    year: "年だけ",
    hidden: "出さない",
  },
  tags: { public: "公開タグ", hidden: "出さない" },
  exif: { all: "すべて", basic: "露出だけ", hidden: "出さない" },
  world: { link: "リンクまで", name: "名前だけ", hidden: "出さない" },
  location: {
    exact: "正確な位置",
    city: "市区町村くらい",
    prefecture: "都道府県くらい",
    country: "国くらい",
    hidden: "出さない",
  },
};

/** Every field, in the order the controls list them. */
export const METADATA_FIELDS: readonly MetadataField[] = EDITABLE_FIELDS;

export const isLevel = <F extends MetadataField>(
  field: F,
  v: unknown,
): v is MetadataLevels[F] =>
  (METADATA_LEVELS[field] as readonly unknown[]).includes(v);

const isField = (k: string): k is MetadataField => k in METADATA_LEVELS;

/** Stored JSON (a photo's overrides or the site's defaults), read leniently. */
export const parseOverrides = (
  raw: string | null | undefined,
): MetadataOverrides => {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, level] of Object.entries(v)) {
    if (!isField(k) || level === null) continue;
    // As the API Worker reads it: a value that is not a level is hidden.
    out[k] = isLevel(k, level) ? (level as string) : "hidden";
  }
  return out as MetadataOverrides;
};

/** The site's defaults: the stored ones over the built-in ones. */
export const siteDefaults = (
  raw: string | null | undefined,
): MetadataLevels => ({
  ...BUILTIN_DEFAULTS,
  ...parseOverrides(raw),
});

/**
 * Overrides from a form or a request: an object of field → level, where
 * "" (or a missing field) means "the site's default". Null if malformed.
 */
export const validateOverrides = (
  v: unknown,
): { ok: true; value: MetadataOverrides } | { ok: false; error: string } => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "metadata_visibility must be an object" };
  }
  const out: Record<string, string> = {};
  for (const [k, level] of Object.entries(v)) {
    if (!isField(k)) return { ok: false, error: `unknown field ${k}` };
    if (level === "" || level === null) continue;
    if (!isLevel(k, level)) {
      return {
        ok: false,
        error: `${k} must be one of ${METADATA_LEVELS[k].join(", ")}`,
      };
    }
    out[k] = level as string;
  }
  return { ok: true, value: out as MetadataOverrides };
};
