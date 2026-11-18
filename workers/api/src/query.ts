/**
 * Read-only D1 queries behind the public API, and the row → JSON
 * conversions. Visibility is enforced here, in SQL:
 *
 * - lists contain `public` photos only;
 * - a single photo (by public id or legacy index) may also be `unlisted`;
 * - `private` photos are never returned;
 * - nor are photos whose upload has not completed (`status <> 'ready'`)
 *   or that are in the trash (`trashed_at`).
 */
import type {
  CameraImageJSON,
  CameraJSON,
  CameraKind,
  MediaItemJSON,
} from "./types";

/** media joined with its camera's names. */
export type MediaJoinRow = {
  public_id: string;
  file: string;
  /** 1 when the file name may be shown (admin migration 0005). */
  filename_public: number;
  platform: string;
  timestamp: string | null;
  tags: string;
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

const MEDIA_SELECT = `
  SELECT m.public_id, m.file, m.filename_public, m.platform, m.timestamp, m.tags,
         c.slug AS camera_slug, c.name AS camera_name,
         c.manufacturer AS camera_manufacturer, c.model AS camera_model
  FROM media m LEFT JOIN camera c ON c.id = m.camera_id`;

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

/**
 * A photo as the public API shows it: the file name only when it is public
 * (`filename_public`), else null. `withFile` is for the image Worker's own
 * lookups (RPC), which need the bucket path to fetch the original.
 */
export const rowToItem = (
  row: MediaJoinRow,
  withFile = false,
): MediaItemJSON => ({
  id: row.public_id,
  file: withFile || row.filename_public === 1 ? row.file : null,
  platform: row.platform === "VRChat" ? "VRChat" : "Real",
  // Deprecated alias of platform (see MediaItemJSON).
  world: row.platform === "VRChat" ? "VRChat" : "Real",
  timestamp: row.timestamp,
  camera:
    row.camera_slug === null
      ? null
      : {
          slug: row.camera_slug,
          name: row.camera_name ?? row.camera_slug,
          manufacturer: row.camera_manufacturer,
          model: row.camera_model,
        },
  tags: parseTags(row.tags),
});

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
  const res = await db
    .prepare(
      `${MEDIA_SELECT} WHERE ${LISTED}
       ORDER BY m.timestamp IS NULL, m.timestamp DESC, m.id DESC`,
    )
    .all<MediaJoinRow>();
  return (res.results ?? []).map((r) => rowToItem(r));
};

/** A public or unlisted photo by its public id. */
export const getMedia = async (
  db: D1Database,
  publicId: string,
): Promise<MediaItemJSON | null> => {
  const row = await db
    .prepare(`${MEDIA_SELECT} WHERE m.public_id = ? AND ${VIEWABLE}`)
    .bind(publicId)
    .first<MediaJoinRow>();
  return row ? rowToItem(row) : null;
};

export type FileAccess =
  { kind: "photo"; photo: MediaItemJSON } | { kind: "camera-image" };

/**
 * A public or unlisted photo by its public id, with its bucket path even
 * when the file name is not public: for the image Worker (RPC), which
 * fetches the original by it and never shows it.
 */
export const getPhotoForImage = async (
  db: D1Database,
  publicId: string,
): Promise<MediaItemJSON | null> => {
  const row = await db
    .prepare(`${MEDIA_SELECT} WHERE m.public_id = ? AND ${VIEWABLE}`)
    .bind(publicId)
    .first<MediaJoinRow>();
  return row ? rowToItem(row, true) : null;
};

/**
 * Whether the image Worker may serve a bucket path by file name: a public
 * photo whose file name is public (with its metadata, for the og caption)
 * or a picture of a camera. Null for anything else, in particular unlisted
 * and private photos, whose predictable file paths must not give them
 * away, and photos whose name is not public (reachable by public id only).
 */
export const getFileAccess = async (
  db: D1Database,
  file: string,
): Promise<FileAccess | null> => {
  const [photos, images] = await db.batch([
    db
      .prepare(
        `${MEDIA_SELECT} WHERE m.file = ? AND ${LISTED} AND m.filename_public = 1`,
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
  if (row) return { kind: "photo", photo: rowToItem(row) };
  return (images.results ?? []).length > 0 ? { kind: "camera-image" } : null;
};

/**
 * Public id of the photo that was /photo/<index> before public ids.
 * Unlisted photos are included on purpose: every legacy index belongs to a
 * photo that was publicly listed when its old URL was shared, so the old
 * link keeps working after the photo is unlisted.
 */
export const getLegacyId = async (
  db: D1Database,
  index: number,
): Promise<string | null> => {
  const row = await db
    .prepare(
      `SELECT public_id FROM media m WHERE legacy_index = ? AND ${VIEWABLE}`,
    )
    .bind(index)
    .first<{ public_id: string }>();
  return row?.public_id ?? null;
};

/**
 * Cameras follow their photos: one is listed only when a public photo was
 * taken with it, and can be opened by slug only when a public or unlisted
 * one was (so an unlisted photo's camera link works). Gear used only for
 * private photos stays hidden.
 */
const cameraUsed = (visibility: string) =>
  `EXISTS (SELECT 1 FROM media m WHERE m.camera_id = c.id AND ${visibility})`;

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
