/**
 * Read-only D1 queries behind the public API, and the row → JSON
 * conversions. Which photos may be seen is decided here, in SQL:
 *
 * - lists contain `public` photos only;
 * - a single photo (by public id) may also be `unlisted`;
 * - `private` photos are never returned;
 * - nor are photos whose upload has not completed (`status <> 'ready'`)
 *   or that are in the trash (`trashed_at`).
 *
 * How much of each photo's metadata is shown is decided by projectPhoto
 * (metadata.ts levels), the one place every response goes through; the
 * SQL only needs the levels where they pick rows (levelSql).
 */
import {
  BUILTIN_DEFAULTS,
  effectiveLevels,
  exifAt,
  locationAt,
  worldAt,
  truncateTimestamp,
  type MetadataField,
  type MetadataLevels,
} from "./metadata";
import {
  effectiveTags,
  publicTagFields,
  rowToDef,
  type TagFieldDef,
} from "../../../shared/tag-field/tag-field";
import type {
  CameraImageJSON,
  CameraJSON,
  CameraKind,
  MediaCameraJSON,
  MediaItemJSON,
  PlatformKind,
} from "./types";

/** media joined with its camera's names. */
export type MediaJoinRow = {
  public_id: string;
  file: string;
  /** The admin's display path (0005); NULL only in old test tables. */
  path: string | null;
  platform: string;
  timestamp: string | null;
  tags: string;
  /** This photo's metadata visibility overrides (JSON), or NULL. */
  metadata_visibility: string | null;
  /** Where it was taken (degrees; both NULL when unknown). */
  latitude: number | null;
  longitude: number | null;
  /** Camera settings (JSON, metadata.ts ExifJSON), or NULL. */
  exif: string | null;
  /** The VRChat world (wrld_…) and its name. */
  world_id: string | null;
  world_name: string | null;
  /** 0009: embed the public shooting info in served images (1/0/NULL). */
  embed_exif?: number | null;
  /** 0016: the pixel size as displayed (NULL when unknown). */
  width?: number | null;
  height?: number | null;
  /** The photo's values of its tags' fields (JSON, 0010), or NULL. */
  tag_values?: string | null;
  /** Its own levels for them (JSON), or NULL. */
  tag_value_visibility?: string | null;
  /** Its camera (0011: the camera's tags it inherits); absent in old tests. */
  camera_id?: number | null;
  camera_slug: string | null;
  camera_name: string | null;
  camera_manufacturer: string | null;
  camera_model: string | null;
  /** 0009: when and with what it was digitised (absent in old tables). */
  digitized_at?: string | null;
  digitizer_slug?: string | null;
  digitizer_name?: string | null;
  digitizer_manufacturer?: string | null;
  digitizer_model?: string | null;
};

export type CameraRow = {
  id: number;
  slug: string;
  name: string;
  manufacturer: string | null;
  manufacturer_url: string | null;
  model: string | null;
  kind: string | null;
  description: string | null;
  product_url: string | null;
};

export type CameraImageRow = {
  camera_id: number;
  file: string;
  caption: string | null;
  position: number;
  id: number;
};

/** What projectPhoto needs besides the row: the site's defaults, public tags. */
export type Context = {
  /** The `setting` row metadata_visibility (JSON), or null. */
  site: string | null;
  publicTags: ReadonlySet<string>;
  /**
   * The `setting` row embed_exif: whether served images carry the public
   * shooting information as EXIF when a photo does not say (default on).
   */
  embedDefault: boolean;
  /** The fields of public tags (0010); none when left out. */
  tagFields?: readonly TagFieldDef[];
  /** Tags each camera passes on to its photos (0011), by camera id. */
  cameraTags?: ReadonlyMap<number, readonly string[]>;
  /** The admin's `platform` table (0014) by key. */
  platforms: ReadonlyMap<string, { name: string; kind: PlatformKind }>;
};

const MEDIA_SELECT = `
  SELECT m.public_id, m.file, m.path, m.platform, m.timestamp, m.tags,
         m.camera_id,
         m.metadata_visibility, m.latitude, m.longitude,
         m.exif, m.world_id, m.world_name, m.embed_exif,
         m.tag_values, m.tag_value_visibility,
         -- The original's size (0016); an edit shown instead (0013) may
         -- be cropped: unknown then, the gallery takes the image's own.
         CASE WHEN m.active_file_id IS NULL THEN m.width END AS width,
         CASE WHEN m.active_file_id IS NULL THEN m.height END AS height,
         c.slug AS camera_slug, c.name AS camera_name,
         c.manufacturer AS camera_manufacturer, c.model AS camera_model,
         m.digitized_at,
         d.slug AS digitizer_slug, d.name AS digitizer_name,
         d.manufacturer AS digitizer_manufacturer, d.model AS digitizer_model
  FROM media m LEFT JOIN camera c ON c.id = m.camera_id
  LEFT JOIN camera d ON d.id = m.digitized_with`;

/**
 * The file the image Worker resizes for the photo `m` (admin 0013): the
 * file the photo shows (`active_file_id`, NULL = its original), or that
 * file's newest ready display copy when it has one. A few index steps for
 * one photo (the original by idx_media_file_original, the shown file by
 * its id, the copy by idx_media_file_source): only the single-photo RPC
 * lookups add it. The public list never reads media_file.
 */
const SOURCE_COLUMNS = `,
  src.storage AS source_storage, src.object_key AS source_key`;
const SOURCE_JOINS = `
  LEFT JOIN media_file shown ON shown.id = COALESCE(m.active_file_id,
    (SELECT o.id FROM media_file o
     WHERE o.media_id = m.id AND o.role = 'original'))
    AND shown.media_id = m.id
  LEFT JOIN media_file src ON src.id = COALESCE(
    (SELECT dc.id FROM media_file dc
     WHERE dc.source_file_id = shown.id AND dc.role = 'display'
       AND dc.status = 'ready' AND dc.media_id = m.id
     ORDER BY dc.id DESC LIMIT 1),
    shown.id)`;

/** MEDIA_SELECT with the file to resize (sourceOf). */
const MEDIA_SELECT_WITH_SOURCE = MEDIA_SELECT.replace(
  " FROM media m",
  `${SOURCE_COLUMNS}\n  FROM media m`,
).concat(SOURCE_JOINS);

/** media_file.storage (admin 0013). */
export type FileStorage = "b2" | "r2";

/** Where the image Worker reads a photo's image from. */
export type FileSource = { storage: FileStorage; key: string };

type SourceRow = {
  source_storage?: string | null;
  source_key?: string | null;
};

/**
 * The file to resize, from the SOURCE_COLUMNS of a row: the original's
 * bucket key when the photo has no media_file row (0013 and its trigger
 * give every photo one; this only keeps such a photo servable).
 */
export const sourceOf = (row: MediaJoinRow & SourceRow): FileSource =>
  row.source_key
    ? {
        storage: row.source_storage === "r2" ? "r2" : "b2",
        key: row.source_key,
      }
    : { storage: "b2", key: row.file };

const SITE_SETTING =
  "(SELECT value FROM setting WHERE key = 'metadata_visibility')";

/**
 * A field's level for the photo `m` in SQL, the same as effectiveLevels:
 * the photo's override, else the site's default, else the built-in one.
 * (An unknown value is compared as is, so it never equals a real level:
 * hidden, as in effectiveLevels.)
 */
export const levelSql = (field: MetadataField): string =>
  `COALESCE(json_extract(m.metadata_visibility, '$.${field}'),
            json_extract(${SITE_SETTING}, '$.${field}'),
            '${BUILTIN_DEFAULTS[field]}')`;

/**
 * A photo whose upload has completed (admin migration 0004) and that is
 * not in the admin's trash (0005). Rows still `uploading` reserve a path
 * but may have no file yet; trashed ones are on their way out. Neither is
 * ever served.
 */
const READY = "m.status = 'ready' AND m.trashed_at IS NULL";

/** Photos that are listed. */
const LISTED = `${READY} AND m.visibility = 'public'`;

/** Photos that may be opened by their URL. */
const VIEWABLE = `${READY} AND m.visibility IN ('public', 'unlisted')`;

const CAMERA_KINDS: readonly string[] = [
  "digital",
  "film",
  "phone",
  "virtual",
  "scanner",
];

const parseTags = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
};

/** The statements whose results make a Context (run them in the batch). */
const contextStatements = (db: D1Database, withFields = true) => [
  db.prepare(
    `SELECT key, value FROM setting
     WHERE key IN ('metadata_visibility', 'embed_exif')`,
  ),
  db.prepare("SELECT name FROM tag WHERE public = 1"),
  // Only public tags' fields ever reach a projection (a handful of rows).
  // The image Worker's lookups never use them: no rows read there.
  db.prepare(
    withFields
      ? `SELECT f.id, t.name AS tag, f.label, f.type, f.options, f.visibility,
                f.position
         FROM tag_field f JOIN tag t ON t.id = f.tag_id WHERE t.public = 1`
      : "SELECT 1 WHERE 0",
  ),
  // The public tags cameras pass on to their photos (0011; a few rows,
  // merged in projectPhoto: never a join per photo).
  db.prepare(
    `SELECT ct.camera_id, ct.tag FROM camera_tag ct
     JOIN tag t ON t.name = ct.tag
     WHERE ct.propagate = 1 AND t.public = 1
     ORDER BY ct.camera_id, ct.position, ct.tag`,
  ),
  // The platforms (0014; a few rows: read whole rather than joined to
  // every photo).
  db.prepare("SELECT key, name, kind FROM platform"),
];

/** How many results of a batch contextStatements makes. */
const CONTEXT_SIZE = 5;

const toContext = (results: readonly D1Result<unknown>[]): Context => {
  const [settings, tags, fields, cameraTags, platforms] = results;
  const rows = (settings.results ?? []) as { key: string; value: string }[];
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const byCamera = new Map<number, string[]>();
  for (const r of (cameraTags.results ?? []) as {
    camera_id: number;
    tag: string;
  }[]) {
    byCamera.set(r.camera_id, [...(byCamera.get(r.camera_id) ?? []), r.tag]);
  }
  return {
    site: value("metadata_visibility") ?? null,
    publicTags: new Set(
      ((tags.results ?? []) as { name: string }[]).map((t) => t.name),
    ),
    // Only an explicit false turns it off.
    embedDefault: value("embed_exif") !== "false",
    tagFields: ((fields.results ?? []) as Parameters<typeof rowToDef>[0][])
      .map(rowToDef)
      .filter((d): d is TagFieldDef => d !== null),
    cameraTags: byCamera,
    platforms: new Map(
      (
        (platforms.results ?? []) as {
          key: string;
          name: string;
          kind: string;
        }[]
      ).map((p) => [
        p.key,
        { name: p.name, kind: p.kind === "real" ? "real" : "virtual" },
      ]),
    ),
  };
};

/**
 * A photo's platform: its row, or for a key with none (cannot happen while
 * media.platform REFERENCES platform) the key as its name and virtual, so
 * no position is shown.
 */
const platformOf = (
  ctx: Context,
  key: string,
): { name: string; kind: PlatformKind } =>
  ctx.platforms.get(key) ?? { name: key, kind: "virtual" };

type JoinedCamera = {
  slug: string | null | undefined;
  name: string | null | undefined;
  manufacturer: string | null | undefined;
  model: string | null | undefined;
};

/** A joined camera row (the shooting camera or the スキャン機材) at a level. */
const cameraAt = (
  c: JoinedCamera,
  level: "model" | "manufacturer" | "hidden",
): MediaCameraJSON | null => {
  if (!c.slug || level === "hidden") return null;
  if (level === "manufacturer") {
    return c.manufacturer
      ? {
          slug: null,
          name: c.manufacturer,
          manufacturer: c.manufacturer,
          model: null,
        }
      : null;
  }
  return {
    slug: c.slug,
    name: c.name ?? c.slug,
    manufacturer: c.manufacturer ?? null,
    model: c.model ?? null,
  };
};

/** When it was digitised, cut down like the taken-at time. */
const digitizedAt = (
  ts: string | null,
  level: MetadataLevels["digitized_at"],
): Pick<MediaItemJSON, "digitized_at" | "digitized_at_precision"> => {
  const at = truncateTimestamp(ts, level);
  return {
    digitized_at: at,
    digitized_at_precision: at === null || level === "hidden" ? null : level,
  };
};

/**
 * effectiveLevels, remembered: most photos share the same overrides, so
 * the list does not parse the same two JSON strings for every photo.
 */
const levelsMemo = new Map<string, ReturnType<typeof effectiveLevels>>();
const levelsOf = (site: string | null, photo: string | null) => {
  const key = `${site ?? ""}\u0000${photo ?? ""}`;
  let levels = levelsMemo.get(key);
  if (!levels) {
    if (levelsMemo.size >= 1000) levelsMemo.clear();
    levels = Object.freeze(effectiveLevels(site, photo));
    levelsMemo.set(key, levels);
  }
  return levels;
};

/** The pixel size (0016): both positive integers, or both null. */
const sizeOf = (
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number | null; height: number | null } =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  (width as number) > 0 &&
  (height as number) > 0
    ? { width: width as number, height: height as number }
    : { width: null, height: null };

/**
 * A photo as the public API shows it: each piece of metadata at the level
 * its visibility allows. `withKey` is for the image Worker's own lookups
 * (RPC): `file` is then the bucket key whatever the level, to fetch the
 * original by; the rest is still cut down (it goes into og captions).
 */
export const projectPhoto = (
  row: MediaJoinRow,
  ctx: Context,
  withKey = false,
): MediaItemJSON => {
  const levels = levelsOf(ctx.site, row.metadata_visibility);
  const path = row.path ?? row.file;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const timestamp = truncateTimestamp(row.timestamp, levels.taken_at);
  // Its own tags and those its camera passes on (0011), public ones only.
  const tags =
    levels.tags === "public"
      ? effectiveTags(
          parseTags(row.tags),
          row.camera_id == null ? [] : ctx.cameraTags?.get(row.camera_id),
        ).filter((t) => ctx.publicTags.has(t))
      : [];
  const platform = platformOf(ctx, row.platform);
  return {
    id: row.public_id,
    file:
      withKey || (levels.file_name === "path" && path === row.file)
        ? row.file
        : null,
    path: levels.file_name === "path" ? path : null,
    name: levels.file_name === "hidden" ? null : name,
    platform: row.platform,
    platform_name: platform.name,
    platform_kind: platform.kind,
    timestamp,
    timestamp_precision:
      timestamp === null || levels.taken_at === "hidden"
        ? null
        : levels.taken_at,
    camera: cameraAt(
      {
        slug: row.camera_slug,
        name: row.camera_name,
        manufacturer: row.camera_manufacturer,
        model: row.camera_model,
      },
      levels.camera,
    ),
    digitizer: cameraAt(
      {
        slug: row.digitizer_slug,
        name: row.digitizer_name,
        manufacturer: row.digitizer_manufacturer,
        model: row.digitizer_model,
      },
      levels.digitizer,
    ),
    ...digitizedAt(row.digitized_at ?? null, levels.digitized_at),
    // A photo on a virtual platform (VRChat, …) was taken in a world, not
    // at a real-world place: a position on one (a mistake, or the player's
    // own GPS) is never public.
    location:
      platform.kind !== "real"
        ? null
        : locationAt(row.latitude, row.longitude, levels.location),
    world: worldAt(row.world_id, row.world_name, levels.world),
    exif: exifAt(row.exif, levels.exif, levels),
    embed_exif:
      row.embed_exif === 1
        ? true
        : row.embed_exif === 0
          ? false
          : ctx.embedDefault,
    // Not metadata to hide: anyone who sees the photo sees its size.
    ...sizeOf(row.width, row.height),
    tags,
    // Fields of the tags it shows (so never of a private tag, nor when
    // its tags are hidden), each at its level on this photo.
    tag_fields: publicTagFields(
      tags,
      (ctx.tagFields ?? []).filter((d) => ctx.publicTags.has(d.tag)),
      row.tag_values,
      row.tag_value_visibility,
    ),
  };
};

export const rowToCamera = (
  row: CameraRow,
  images: readonly CameraImageRow[],
): CameraJSON => ({
  slug: row.slug,
  name: row.name,
  manufacturer: row.manufacturer,
  manufacturerUrl: row.manufacturer_url,
  model: row.model,
  kind:
    row.kind !== null && CAMERA_KINDS.includes(row.kind)
      ? (row.kind as CameraKind)
      : null,
  description: row.description,
  productUrl: row.product_url,
  images: images
    .filter((img) => img.camera_id === row.id)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map(({ file, caption }): CameraImageJSON => ({ file, caption })),
});

/** Every public photo, newest first (undated last). */
export const listPublicMedia = async (
  db: D1Database,
): Promise<MediaItemJSON[]> => {
  const results = await db.batch([
    ...contextStatements(db),
    db.prepare(LIST_SQL),
  ]);
  const ctx = toContext(results);
  const photos = results[CONTEXT_SIZE];
  return ((photos.results ?? []) as MediaJoinRow[]).map((r) =>
    projectPhoto(r, ctx),
  );
};

/** The public API's single-photo query (no media_file). */
export const MEDIA_BY_ID_SQL = `${MEDIA_SELECT} WHERE m.public_id = ? AND ${VIEWABLE}`;

/** The image Worker's: the same photo and the file to resize. */
export const IMAGE_BY_ID_SQL = `${MEDIA_SELECT_WITH_SOURCE} WHERE m.public_id = ? AND ${VIEWABLE}`;

/** The public list (`/api/media`); it never reads media_file. */
export const LIST_SQL = `${MEDIA_SELECT} WHERE ${LISTED}
       ORDER BY m.timestamp IS NULL, m.timestamp DESC, m.id DESC`;

/** A public or unlisted photo by its public id. */
export const getMedia = async (
  db: D1Database,
  publicId: string,
): Promise<MediaItemJSON | null> => {
  const results = await db.batch([
    ...contextStatements(db),
    db.prepare(MEDIA_BY_ID_SQL).bind(publicId),
  ]);
  const row = (results[CONTEXT_SIZE].results ?? [])[0] as
    MediaJoinRow | undefined;
  return row ? projectPhoto(row, toContext(results)) : null;
};

/**
 * A photo as the image Worker gets it (RPC): projected, but with its
 * bucket key in `file` whatever its file name level, and `source`, the
 * file to resize (sourceOf). Never shown.
 */
export type ImagePhoto = MediaItemJSON & { file: string; source: FileSource };

const imagePhoto = (
  row: MediaJoinRow & SourceRow,
  ctx: Context,
): ImagePhoto => ({
  ...projectPhoto(row, ctx, true),
  file: row.file,
  source: sourceOf(row),
});

/** A public or unlisted photo by its public id, for the image Worker. */
export const getPhotoForImage = async (
  db: D1Database,
  publicId: string,
): Promise<ImagePhoto | null> => {
  const results = await db.batch([
    // The image Worker has no use for tag fields.
    ...contextStatements(db, false),
    db.prepare(IMAGE_BY_ID_SQL).bind(publicId),
  ]);
  const row = (results[CONTEXT_SIZE].results ?? [])[0] as
    (MediaJoinRow & SourceRow) | undefined;
  return row ? imagePhoto(row, toContext(results)) : null;
};

/**
 * A camera picture: `file` is the bucket key to resize, and `source`
 * where it is (a photo's picture may be shown from another storage). No
 * EXIF is embedded in either kind.
 */
export type PathAccess =
  | { kind: "photo"; photo: ImagePhoto }
  | { kind: "camera-image"; file: string; source: FileSource };

/** The image Worker's photo by display path (see getPathAccess). */
export const IMAGE_BY_PATH_SQL = `${MEDIA_SELECT_WITH_SOURCE} WHERE m.path = ?1 AND ${LISTED}
           AND ${levelSql("file_name")} = 'path'`;

/**
 * A camera picture of its own at bucket path ?1 (admin 0019: such a
 * `file` is never a photo's object, which triggers keep so, so it gives
 * no photo away).
 */
export const CAMERA_IMAGE_SQL = `SELECT 1 AS found FROM camera_image WHERE file = ?1 LIMIT 1`;

/**
 * The public path of a camera picture that is a photo (admin 0019,
 * `camera_image.media_id`): under the camera's folder, by the picture's
 * id, so it names neither the photo's public id nor its file. The
 * extension is only there for the image Worker's path syntax. A numbered
 * upload name (`a-1.jpg`) never has this shape, and the admin refuses it
 * for a picture's own file (isPhotoPicturePath), which would come first.
 */
export const photoPicturePath = (slug: string, id: number): string =>
  `/camera/${slug}/${id}.photo.jpg`;

const PHOTO_PICTURE_PATH_SQL = `'/camera/' || c.slug || '/' || i.id || '.photo.jpg'`;

const PHOTO_PICTURE_RE =
  /^\/camera\/([a-z0-9-]+)\/([1-9][0-9]{0,14})\.photo\.jpg$/;

/**
 * The file to resize for the photo picture ?2 of the camera with slug ?1,
 * while its photo is listed (public, ready, not in the trash): a camera
 * page is public, so an unlisted photo, which opens only by its own URL,
 * or a private one chosen as a picture is never served.
 */
export const PHOTO_PICTURE_SQL = `SELECT m.file${SOURCE_COLUMNS}
  FROM camera_image i JOIN camera c ON c.id = i.camera_id
  JOIN media m ON m.id = i.media_id${SOURCE_JOINS}
  WHERE i.id = ?2 AND c.slug = ?1 AND ${LISTED}`;

/**
 * What the image Worker may serve at /img/<path>: a public photo whose
 * display path is `path` and whose file name level is "path" (so a moved
 * photo is found at its new path, and its bucket key, which may differ,
 * comes back in `photo.file`, and the file to resize in `photo.source`;
 * the rest is projected, for captions); a camera picture whose bucket path
 * is `path`; or a camera picture that is a photo, at photoPicturePath,
 * while the photo is public. Null for anything else, in particular
 * unlisted and private photos, whose predictable paths must not give them
 * away, and a moved photo's old path.
 */
export const getPathAccess = async (
  db: D1Database,
  path: string,
): Promise<PathAccess | null> => {
  const picture = PHOTO_PICTURE_RE.exec(path);
  const results = await db.batch([
    ...contextStatements(db, false),
    db.prepare(IMAGE_BY_PATH_SQL).bind(path),
    db.prepare(CAMERA_IMAGE_SQL).bind(path),
    ...(picture
      ? [db.prepare(PHOTO_PICTURE_SQL).bind(picture[1], Number(picture[2]))]
      : []),
  ]);
  const [photos, images, pictures] = results.slice(CONTEXT_SIZE);
  const row = (photos.results ?? [])[0] as
    (MediaJoinRow & SourceRow) | undefined;
  if (row) {
    return { kind: "photo", photo: imagePhoto(row, toContext(results)) };
  }
  if ((images.results ?? []).length > 0) {
    return {
      kind: "camera-image",
      file: path,
      source: { storage: "b2", key: path },
    };
  }
  const shown = (pictures?.results ?? [])[0] as
    (SourceRow & { file: string }) | undefined;
  if (!shown) return null;
  const source = sourceOf(shown as MediaJoinRow & SourceRow);
  return { kind: "camera-image", file: source.key, source };
};

/**
 * Cameras follow their photos: one is listed only when a public photo
 * shows it (its camera level is "model"), and can be opened by slug only
 * when a public or unlisted one does. Gear that only private photos, or
 * photos that hide it, were taken with stays hidden.
 */
const cameraUsed = (visibility: string) =>
  `(EXISTS (SELECT 1 FROM media m WHERE m.camera_id = c.id AND ${visibility}
              AND ${levelSql("camera")} = 'model')
    OR EXISTS (SELECT 1 FROM media m WHERE m.digitized_with = c.id
              AND ${visibility} AND ${levelSql("digitizer")} = 'model'))`;

/**
 * Camera pictures as the API gives them: a picture of its own by its
 * bucket path, a photo (admin 0019) at photoPicturePath and only while the
 * photo is public (ready, not in the trash; never unlisted, which would
 * show it on a public page).
 */
export const CAMERA_IMAGES_SQL = `SELECT i.id, i.camera_id, i.position, i.caption,
    COALESCE(i.file, ${PHOTO_PICTURE_PATH_SQL}) AS file
  FROM camera_image i JOIN camera c ON c.id = i.camera_id
  LEFT JOIN media m ON m.id = i.media_id
  WHERE (i.media_id IS NULL OR (${LISTED}))`;

/** Cameras with at least one public photo, by slug. */
export const listCameras = async (db: D1Database): Promise<CameraJSON[]> => {
  const [cameras, images] = await db.batch([
    db.prepare(
      `SELECT c.* FROM camera c WHERE ${cameraUsed(LISTED)} ORDER BY c.slug`,
    ),
    db.prepare(CAMERA_IMAGES_SQL),
  ]);
  const imageRows = (images.results ?? []) as CameraImageRow[];
  return ((cameras.results ?? []) as CameraRow[]).map((c) =>
    rowToCamera(c, imageRows),
  );
};

export const getCamera = async (
  db: D1Database,
  slug: string,
): Promise<CameraJSON | null> => {
  const [cameras, images] = await db.batch([
    db
      .prepare(
        `SELECT c.* FROM camera c WHERE c.slug = ? AND ${cameraUsed(VIEWABLE)}`,
      )
      .bind(slug),
    db.prepare(`${CAMERA_IMAGES_SQL} AND c.slug = ?`).bind(slug),
  ]);
  const row = (cameras.results ?? [])[0] as CameraRow | undefined;
  return row
    ? rowToCamera(row, (images.results ?? []) as CameraImageRow[])
    : null;
};

/**
 * The `setting` row the admin rewrites (to a new random value) after
 * every change to what this API answers (admin/src/lib/last-good.ts).
 * Missing until the admin's first change: "".
 */
export const CONTENT_VERSION_KEY = "content_version";

/** The current content version: one single-row read. */
export const readContentVersion = async (db: D1Database): Promise<string> =>
  (
    await db
      .prepare("SELECT value FROM setting WHERE key = ?")
      .bind(CONTENT_VERSION_KEY)
      .first<{ value: string }>()
  )?.value ?? "";
