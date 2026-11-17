import {
  CAMERA_KINDS,
  type CameraImageRow,
  type CameraInput,
  type CameraKind,
  type CameraRow,
  type MediaPatch,
  type MediaRow,
  type MediaWorld,
  isVisibility,
  type Visibility,
} from "./types";

type RawRow = {
  id: number;
  public_id: string;
  file: string;
  world: string;
  timestamp: string | null;
  camera_id: number | null;
  tags: string;
  visibility: string;
  legacy_index: number | null;
  updated_at: string;
};

type RawCameraRow = {
  id: number;
  slug: string;
  name: string;
  manufacturer: string | null;
  manufacturer_url: string | null;
  model: string | null;
  kind: string | null;
  description: string | null;
  product_url: string | null;
  updated_at: string;
};

const isWorld = (v: string): v is MediaWorld => v === "Real" || v === "VRChat";

const isCameraKind = (v: string): v is CameraKind =>
  (CAMERA_KINDS as readonly string[]).includes(v);

const parseTags = (raw: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `tags column is not valid JSON: ${raw} (${err instanceof Error ? err.message : err})`,
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((t) => typeof t === "string")) {
    throw new Error(`tags column is not a JSON string array: ${raw}`);
  }
  return parsed;
};

export const rowToMedia = (raw: RawRow): MediaRow => {
  if (!isWorld(raw.world)) {
    throw new Error(`unknown world value in DB: ${raw.world}`);
  }
  if (!isVisibility(raw.visibility)) {
    throw new Error(`unknown visibility value in DB: ${raw.visibility}`);
  }
  return {
    id: raw.id,
    public_id: raw.public_id,
    file: raw.file,
    world: raw.world,
    timestamp: raw.timestamp,
    camera_id: raw.camera_id,
    tags: parseTags(raw.tags),
    visibility: raw.visibility,
    legacy_index: raw.legacy_index,
    updated_at: raw.updated_at,
  };
};

export const rowToCamera = (raw: RawCameraRow): CameraRow => {
  if (raw.kind !== null && !isCameraKind(raw.kind)) {
    throw new Error(`unknown camera kind in DB: ${raw.kind}`);
  }
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    manufacturer: raw.manufacturer,
    manufacturer_url: raw.manufacturer_url,
    model: raw.model,
    kind: raw.kind,
    description: raw.description,
    product_url: raw.product_url,
    updated_at: raw.updated_at,
  };
};

export type ListParams = {
  world?: MediaWorld;
  visibility?: Visibility;
  q?: string;
  limit: number;
  offset: number;
};

export type ListResult = {
  rows: MediaRow[];
  total: number;
};

export const listMedia = async (
  db: D1Database,
  params: ListParams,
): Promise<ListResult> => {
  // Uploads that have not completed are not photos yet.
  const where: string[] = ["status = 'ready'"];
  const args: unknown[] = [];
  if (params.world) {
    where.push("world = ?");
    args.push(params.world);
  }
  if (params.visibility) {
    where.push("visibility = ?");
    args.push(params.visibility);
  }
  if (params.q) {
    // Escape LIKE metacharacters so a literal `%` or `_` in the query does
    // not behave as a wildcard.
    const escaped = params.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("file LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rowsStmt = db
    .prepare(
      `SELECT * FROM media ${whereSql} ORDER BY timestamp IS NULL, timestamp DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...args, params.limit, params.offset);
  const countStmt = db
    .prepare(`SELECT COUNT(*) AS c FROM media ${whereSql}`)
    .bind(...args);

  const [rowsRes, countRes] = await Promise.all([
    rowsStmt.all<RawRow>(),
    countStmt.first<{ c: number }>(),
  ]);

  return {
    rows: (rowsRes.results ?? []).map(rowToMedia),
    total: countRes?.c ?? 0,
  };
};

export const getMedia = async (
  db: D1Database,
  id: number,
): Promise<MediaRow | null> => {
  const raw = await db
    .prepare("SELECT * FROM media WHERE id = ?")
    .bind(id)
    .first<RawRow>();
  return raw ? rowToMedia(raw) : null;
};

export const updateMedia = async (
  db: D1Database,
  id: number,
  patch: MediaPatch,
): Promise<MediaRow | null> => {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.world !== undefined) {
    sets.push("world = ?");
    args.push(patch.world);
  }
  if (patch.camera_id !== undefined) {
    sets.push("camera_id = ?");
    args.push(patch.camera_id);
  }
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    args.push(JSON.stringify(patch.tags));
  }
  if (patch.visibility !== undefined) {
    sets.push("visibility = ?");
    args.push(patch.visibility);
  }
  // No-op patch: skip the UPDATE entirely (don't bump updated_at) and just
  // return the current row. Costs a second round-trip but keeps the
  // updated_at semantics honest.
  if (sets.length === 0) return getMedia(db, id);

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const raw = await db
    .prepare(`UPDATE media SET ${sets.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...args, id)
    .first<RawRow>();
  return raw ? rowToMedia(raw) : null;
};

/** Most ids one bulk visibility change accepts (one /media page). */
export const MAX_BULK_IDS = 100;

// One JSON parameter instead of one per id: D1 caps bound parameters at
// 100 per statement.
const SET_VISIBILITY_SQL = `UPDATE media SET visibility = ?1,
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT value FROM json_each(?2)) AND visibility <> ?1`;

const checkBulkSize = (n: number) => {
  if (n > MAX_BULK_IDS) {
    throw new Error(`too many ids (${n} > ${MAX_BULK_IDS})`);
  }
};

export type VisibilityChange = { id: number; visibility: Visibility };

/**
 * Set the visibility of several photos at once. Rows that already have it
 * are left alone (their updated_at does not move). Returns the number of
 * rows changed and, for undo, the previous visibility of each of them
 * (read in the same batch, so it is exactly what the update replaced).
 */
export const setVisibility = async (
  db: D1Database,
  ids: readonly number[],
  visibility: Visibility,
): Promise<{ changed: number; previous: VisibilityChange[] }> => {
  if (ids.length === 0) return { changed: 0, previous: [] };
  checkBulkSize(ids.length);
  const json = JSON.stringify(ids);
  const [before, update] = await db.batch([
    db
      .prepare(
        `SELECT id, visibility FROM media
         WHERE id IN (SELECT value FROM json_each(?2)) AND visibility <> ?1
         ORDER BY id`,
      )
      .bind(visibility, json),
    db.prepare(SET_VISIBILITY_SQL).bind(visibility, json),
  ]);
  return {
    changed: update.meta.changes ?? 0,
    previous: (before.results as VisibilityChange[]).map((r) => ({
      id: r.id,
      visibility: r.visibility,
    })),
  };
};

/**
 * Undo of a bulk change to `from`: put each group of photos back to its
 * visibility, all in one batch (a D1 batch is a transaction). Rows that no
 * longer have `from` (changed again since, e.g. in another tab) are left
 * alone. Returns the number of rows changed.
 */
export const restoreVisibility = async (
  db: D1Database,
  from: Visibility,
  groups: readonly { visibility: Visibility; ids: readonly number[] }[],
): Promise<number> => {
  const nonEmpty = groups.filter((g) => g.ids.length > 0);
  if (nonEmpty.length === 0) return 0;
  checkBulkSize(nonEmpty.reduce((n, g) => n + g.ids.length, 0));
  const results = await db.batch(
    nonEmpty.map((g) =>
      db
        .prepare(`${SET_VISIBILITY_SQL} AND visibility = ?3`)
        .bind(g.visibility, JSON.stringify(g.ids), from),
    ),
  );
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
};

export type CameraListItem = CameraRow & { photo_count: number };

export const listCameras = async (
  db: D1Database,
): Promise<CameraListItem[]> => {
  const res = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM media m WHERE m.camera_id = c.id AND m.status = 'ready') AS photo_count
       FROM camera c ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .all<RawCameraRow & { photo_count: number }>();
  return (res.results ?? []).map((r) => ({
    ...rowToCamera(r),
    photo_count: r.photo_count,
  }));
};

export const getCamera = async (
  db: D1Database,
  id: number,
): Promise<CameraRow | null> => {
  const raw = await db
    .prepare("SELECT * FROM camera WHERE id = ?")
    .bind(id)
    .first<RawCameraRow>();
  return raw ? rowToCamera(raw) : null;
};

/** Thrown by createCamera/updateCamera when the slug is already taken. */
export class SlugConflictError extends Error {
  constructor(slug: string) {
    super(`slug already in use: ${slug}`);
    this.name = "SlugConflictError";
  }
}

const isSlugConflict = (err: unknown): boolean =>
  err instanceof Error &&
  /UNIQUE constraint failed: camera\.slug/.test(err.message);

const cameraArgs = (input: CameraInput) => [
  input.slug,
  input.name,
  input.manufacturer,
  input.manufacturer_url,
  input.model,
  input.kind,
  input.description,
  input.product_url,
];

export const createCamera = async (
  db: D1Database,
  input: CameraInput,
): Promise<CameraRow> => {
  try {
    const raw = await db
      .prepare(
        `INSERT INTO camera (slug, name, manufacturer, manufacturer_url, model, kind, description, product_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(...cameraArgs(input))
      .first<RawCameraRow>();
    if (!raw) throw new Error("INSERT INTO camera returned no row");
    return rowToCamera(raw);
  } catch (err) {
    if (isSlugConflict(err)) throw new SlugConflictError(input.slug);
    throw err;
  }
};

export const updateCamera = async (
  db: D1Database,
  id: number,
  input: CameraInput,
): Promise<CameraRow | null> => {
  try {
    const raw = await db
      .prepare(
        `UPDATE camera SET slug = ?, name = ?, manufacturer = ?, manufacturer_url = ?, model = ?, kind = ?,
           description = ?, product_url = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? RETURNING *`,
      )
      .bind(...cameraArgs(input), id)
      .first<RawCameraRow>();
    return raw ? rowToCamera(raw) : null;
  } catch (err) {
    if (isSlugConflict(err)) throw new SlugConflictError(input.slug);
    throw err;
  }
};

/** A camera's pictures in display order. */
export const listCameraImages = async (
  db: D1Database,
  cameraId: number,
): Promise<CameraImageRow[]> => {
  const res = await db
    .prepare(
      "SELECT * FROM camera_image WHERE camera_id = ? ORDER BY position, id",
    )
    .bind(cameraId)
    .all<CameraImageRow>();
  return res.results ?? [];
};

/** Thrown by addCameraImage when the camera already has that file. */
export class DuplicateImageError extends Error {
  constructor(file: string) {
    super(`image already added: ${file}`);
    this.name = "DuplicateImageError";
  }
}

/** Append a picture after the camera's last one. */
export const addCameraImage = async (
  db: D1Database,
  cameraId: number,
  image: { file: string; caption: string | null },
): Promise<CameraImageRow> => {
  try {
    const row = await db
      .prepare(
        `INSERT INTO camera_image (camera_id, file, caption, position)
         VALUES (?1, ?2, ?3,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_image WHERE camera_id = ?1))
         RETURNING *`,
      )
      .bind(cameraId, image.file, image.caption)
      .first<CameraImageRow>();
    if (!row) throw new Error("INSERT INTO camera_image returned no row");
    return row;
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed: camera_image\./.test(err.message)
    ) {
      throw new DuplicateImageError(image.file);
    }
    throw err;
  }
};

export const updateCameraImageCaption = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
  caption: string | null,
): Promise<boolean> => {
  const res = await db
    .prepare(
      "UPDATE camera_image SET caption = ? WHERE id = ? AND camera_id = ?",
    )
    .bind(caption, imageId, cameraId)
    .run();
  return (res.meta.changes ?? 0) > 0;
};

/**
 * Remove a picture. Returns what undo needs (its file, caption and index
 * in the order), or null when this camera has no such picture.
 */
export const removeCameraImage = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
): Promise<{ file: string; caption: string | null; index: number } | null> => {
  const images = await listCameraImages(db, cameraId);
  const index = images.findIndex((img) => img.id === imageId);
  if (index === -1) return null;
  const res = await db
    .prepare("DELETE FROM camera_image WHERE id = ? AND camera_id = ?")
    .bind(imageId, cameraId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return null;
  const { file, caption } = images[index];
  return { file, caption, index };
};

/**
 * New order after moving `imageId` one step up or down; null when it is
 * not in the list or already at that end.
 */
export const reorderedIds = (
  ids: readonly number[],
  imageId: number,
  direction: "up" | "down",
): number[] | null => {
  const i = ids.indexOf(imageId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/**
 * Move a picture one step; renumbers positions 0..n-1 in one batch. False
 * when this camera has no such picture (already at the end is a no-op).
 */
export const moveCameraImage = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
  direction: "up" | "down",
): Promise<boolean> => {
  const ids = (await listCameraImages(db, cameraId)).map((img) => img.id);
  if (!ids.includes(imageId)) return false;
  const order = reorderedIds(ids, imageId, direction);
  if (!order) return true;
  await setImageOrder(db, cameraId, order);
  return true;
};

/** Positions 0..n-1 in `order`, in one batch. */
const setImageOrder = async (
  db: D1Database,
  cameraId: number,
  order: readonly number[],
): Promise<void> => {
  await db.batch(
    order.map((id, position) =>
      db
        .prepare(
          "UPDATE camera_image SET position = ? WHERE id = ? AND camera_id = ?",
        )
        .bind(position, id, cameraId),
    ),
  );
};

/**
 * The statements of restoreCameraImage, run as one batch (a D1 batch is a
 * transaction, so a failure leaves nothing half done):
 * 1. insert the picture at the position of the one now at `index` in the
 *    order (after the last one when `index` is past the end);
 * 2. move that one and everything after it one step down.
 * Positions may have gaps (a removal does not renumber) and, from raw SQL,
 * ties; the order is (position, id), as in listCameraImages.
 */
export const restoreCameraImageStatements = (
  cameraId: number,
  image: { file: string; caption: string | null },
  index: number,
): { sql: string; args: unknown[] }[] => [
  {
    sql: `INSERT INTO camera_image (camera_id, file, caption, position)
     VALUES (?1, ?2, ?3, COALESCE(
       (SELECT position FROM camera_image WHERE camera_id = ?1
        ORDER BY position, id LIMIT 1 OFFSET ?4),
       (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_image
        WHERE camera_id = ?1)))`,
    args: [cameraId, image.file, image.caption, Math.max(0, index)],
  },
  {
    // The rows from `index` on (by position, then id, so ties keep their
    // order), the inserted one aside.
    sql: `UPDATE camera_image SET position = position + 1
     WHERE camera_id = ?1 AND file <> ?2 AND (position, id) >=
       (SELECT position, id FROM camera_image WHERE camera_id = ?1 AND file <> ?2
        ORDER BY position, id LIMIT 1 OFFSET ?3)`,
    args: [cameraId, image.file, Math.max(0, index)],
  },
];

/**
 * Undo of a removal: add the picture back at `index` (0-based) of the
 * current order, in one batch. Throws DuplicateImageError if the file was
 * added again meanwhile (and then changes nothing).
 */
export const restoreCameraImage = async (
  db: D1Database,
  cameraId: number,
  image: { file: string; caption: string | null },
  index: number,
): Promise<void> => {
  try {
    await db.batch(
      restoreCameraImageStatements(cameraId, image, index).map(
        ({ sql, args }) => db.prepare(sql).bind(...args),
      ),
    );
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed: camera_image\./.test(err.message)
    ) {
      throw new DuplicateImageError(image.file);
    }
    throw err;
  }
};
