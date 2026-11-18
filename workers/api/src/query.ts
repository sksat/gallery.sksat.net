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
} from "./metadata";
import type {
  CameraImageJSON,
  CameraJSON,
  CameraKind,
  MediaCameraJSON,
  MediaItemJSON,
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
  camera_slug: string | null;
  camera_name: string | null;
  camera_manufacturer: string | null;
  camera_model: string | null;
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
};

const MEDIA_SELECT = `
  SELECT m.public_id, m.file, m.path, m.platform, m.timestamp, m.tags,
         m.metadata_visibility, m.latitude, m.longitude,
         m.exif, m.world_id, m.world_name,
         c.slug AS camera_slug, c.name AS camera_name,
         c.manufacturer AS camera_manufacturer, c.model AS camera_model
  FROM media m LEFT JOIN camera c ON c.id = m.camera_id`;

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

const CAMERA_KINDS: readonly string[] = ["digital", "film", "phone", "virtual"];

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
const contextStatements = (db: D1Database) => [
  db.prepare(`SELECT value FROM setting WHERE key = 'metadata_visibility'`),
  db.prepare("SELECT name FROM tag WHERE public = 1"),
];

const toContext = (
  site: D1Result<unknown>,
  tags: D1Result<unknown>,
): Context => ({
  site:
    ((site.results ?? [])[0] as { value?: string } | undefined)?.value ?? null,
  publicTags: new Set(
    ((tags.results ?? []) as { name: string }[]).map((t) => t.name),
  ),
});

const cameraAt = (
  row: MediaJoinRow,
  level: "model" | "manufacturer" | "hidden",
): MediaCameraJSON | null => {
  if (row.camera_slug === null || level === "hidden") return null;
  if (level === "manufacturer") {
    return row.camera_manufacturer === null
      ? null
      : {
          slug: null,
          name: row.camera_manufacturer,
          manufacturer: row.camera_manufacturer,
          model: null,
        };
  }
  return {
    slug: row.camera_slug,
    name: row.camera_name ?? row.camera_slug,
    manufacturer: row.camera_manufacturer,
    model: row.camera_model,
  };
};

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
  const levels = effectiveLevels(ctx.site, row.metadata_visibility);
  const path = row.path ?? row.file;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const timestamp = truncateTimestamp(row.timestamp, levels.taken_at);
  return {
    id: row.public_id,
    file:
      withKey || (levels.file_name === "path" && path === row.file)
        ? row.file
        : null,
    path: levels.file_name === "path" ? path : null,
    name: levels.file_name === "hidden" ? null : name,
    platform: row.platform === "VRChat" ? "VRChat" : "Real",
    timestamp,
    timestamp_precision:
      timestamp === null || levels.taken_at === "hidden"
        ? null
        : levels.taken_at,
    camera: cameraAt(row, levels.camera),
    location: locationAt(row.latitude, row.longitude, levels.location),
    world: worldAt(row.world_id, row.world_name, levels.world),
    exif: exifAt(row.exif, levels.exif),
    tags:
      levels.tags === "public"
        ? parseTags(row.tags).filter((t) => ctx.publicTags.has(t))
        : [],
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
  const [site, tags, photos] = await db.batch([
    ...contextStatements(db),
    db.prepare(
      `${MEDIA_SELECT} WHERE ${LISTED}
       ORDER BY m.timestamp IS NULL, m.timestamp DESC, m.id DESC`,
    ),
  ]);
  const ctx = toContext(site, tags);
  return ((photos.results ?? []) as MediaJoinRow[]).map((r) =>
    projectPhoto(r, ctx),
  );
};

/** One public or unlisted photo by public id, projected. */
const onePhoto = async (
  db: D1Database,
  where: string,
  arg: string,
  withKey: boolean,
): Promise<MediaItemJSON | null> => {
  const [site, tags, photos] = await db.batch([
    ...contextStatements(db),
    db.prepare(`${MEDIA_SELECT} WHERE ${where}`).bind(arg),
  ]);
  const row = (photos.results ?? [])[0] as MediaJoinRow | undefined;
  return row ? projectPhoto(row, toContext(site, tags), withKey) : null;
};

/** A public or unlisted photo by its public id. */
export const getMedia = (
  db: D1Database,
  publicId: string,
): Promise<MediaItemJSON | null> =>
  onePhoto(db, `m.public_id = ? AND ${VIEWABLE}`, publicId, false);

/**
 * A public or unlisted photo by its public id, with its bucket key in
 * `file` whatever its file name level: for the image Worker (RPC), which
 * fetches the original by it and never shows it.
 */
export const getPhotoForImage = (
  db: D1Database,
  publicId: string,
): Promise<MediaItemJSON | null> =>
  onePhoto(db, `m.public_id = ? AND ${VIEWABLE}`, publicId, true);

export type FileAccess =
  { kind: "photo"; photo: MediaItemJSON } | { kind: "camera-image" };

/**
 * Whether the image Worker may serve a bucket path by name: a public photo
 * whose file name is public with its folder ("path") and that is still at
 * that path (not moved), with its metadata for the og caption; or a
 * picture of a camera. Null for anything else, in particular unlisted and
 * private photos, whose predictable paths must not give them away.
 */
export const getFileAccess = async (
  db: D1Database,
  file: string,
): Promise<FileAccess | null> => {
  const [site, tags, photos, images] = await db.batch([
    ...contextStatements(db),
    db
      .prepare(
        `${MEDIA_SELECT} WHERE m.file = ?1 AND ${LISTED}
           AND m.path = m.file AND ${levelSql("file_name")} = 'path'`,
      )
      .bind(file),
    // A camera picture that is also a photo row follows the photo's
    // visibility and status: listing a private photo (or one still being
    // uploaded) as a camera picture must not publish it by path.
    db
      .prepare(
        `SELECT 1 AS found FROM camera_image WHERE file = ?1
           AND NOT EXISTS (SELECT 1 FROM media WHERE file = ?1) LIMIT 1`,
      )
      .bind(file),
  ]);
  const row = (photos.results ?? [])[0] as MediaJoinRow | undefined;
  if (row) {
    return { kind: "photo", photo: projectPhoto(row, toContext(site, tags)) };
  }
  return (images.results ?? []).length > 0 ? { kind: "camera-image" } : null;
};

/**
 * Cameras follow their photos: one is listed only when a public photo
 * shows it (its camera level is "model"), and can be opened by slug only
 * when a public or unlisted one does. Gear that only private photos, or
 * photos that hide it, were taken with stays hidden.
 */
const cameraUsed = (visibility: string) =>
  `EXISTS (SELECT 1 FROM media m WHERE m.camera_id = c.id AND ${visibility}
             AND ${levelSql("camera")} = 'model')`;

/** Cameras with at least one public photo, by slug. */
export const listCameras = async (db: D1Database): Promise<CameraJSON[]> => {
  const [cameras, images] = await db.batch([
    db.prepare(
      `SELECT c.* FROM camera c WHERE ${cameraUsed(LISTED)} ORDER BY c.slug`,
    ),
    db.prepare("SELECT * FROM camera_image"),
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
    db
      .prepare(
        "SELECT i.* FROM camera_image i JOIN camera c ON c.id = i.camera_id WHERE c.slug = ?",
      )
      .bind(slug),
  ]);
  const row = (cameras.results ?? [])[0] as CameraRow | undefined;
  return row
    ? rowToCamera(row, (images.results ?? []) as CameraImageRow[])
    : null;
};
