import {
  CAMERA_KINDS,
  type CameraImageRow,
  type CameraInput,
  type CameraJSON,
  type CameraKind,
  type CameraRow,
  type MediaCamera,
  type MediaInfoJSON,
  type MediaPatch,
  type MediaRow,
  type MediaWorld,
} from "./types";

type RawRow = {
  id: number;
  file: string;
  world: string;
  timestamp: string | null;
  camera_id: number | null;
  tags: string;
  updated_at: string;
};

type RawCameraRow = {
  id: number;
  slug: string;
  name: string;
  make: string | null;
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
  return {
    id: raw.id,
    file: raw.file,
    world: raw.world,
    timestamp: raw.timestamp,
    camera_id: raw.camera_id,
    tags: parseTags(raw.tags),
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
    make: raw.make,
    model: raw.model,
    kind: raw.kind,
    description: raw.description,
    product_url: raw.product_url,
    updated_at: raw.updated_at,
  };
};

/**
 * One item of cameras.json (the row minus admin-only fields, camelCase
 * keys). `images` must already be in display order.
 */
export const cameraToJson = (
  c: CameraRow,
  images: readonly CameraImageRow[] = [],
): CameraJSON => ({
  slug: c.slug,
  name: c.name,
  make: c.make,
  model: c.model,
  kind: c.kind,
  description: c.description,
  productUrl: c.product_url,
  images: images.map(({ file, caption }) => ({ file, caption })),
});

/**
 * The `camera` object embedded in a media.json item. `make`/`model` stay
 * non-null strings so gallery builds that predate cameras.json (they
 * render `${make} ${model}`) keep working: a camera without a model falls
 * back to its display name.
 */
export const mediaCameraJson = (c: CameraRow): MediaCamera => ({
  make: c.make ?? "",
  model: c.model ?? c.name,
  slug: c.slug,
  name: c.name,
});

export const rowToMediaJson = (
  row: MediaRow,
  cameras: ReadonlyMap<number, CameraRow>,
): MediaInfoJSON => {
  let camera: MediaCamera | null = null;
  if (row.camera_id !== null) {
    const c = cameras.get(row.camera_id);
    // The FK makes this unreachable; fail loudly rather than publish a
    // photo that silently lost its camera.
    if (!c) {
      throw new Error(
        `media ${row.id} references missing camera ${row.camera_id}`,
      );
    }
    camera = mediaCameraJson(c);
  }
  return {
    file: row.file,
    world: row.world,
    timestamp: row.timestamp,
    camera,
    tags: row.tags,
  };
};

export type ListParams = {
  world?: MediaWorld;
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
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.world) {
    where.push("world = ?");
    args.push(params.world);
  }
  if (params.q) {
    // Escape LIKE metacharacters so a literal `%` or `_` in the query does
    // not behave as a wildcard.
    const escaped = params.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("file LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

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

export type CameraListItem = CameraRow & { photo_count: number };

export const listCameras = async (
  db: D1Database,
): Promise<CameraListItem[]> => {
  const res = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM media m WHERE m.camera_id = c.id) AS photo_count
       FROM cameras c ORDER BY c.name COLLATE NOCASE, c.id`,
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
    .prepare("SELECT * FROM cameras WHERE id = ?")
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
  /UNIQUE constraint failed: cameras\.slug/.test(err.message);

const cameraArgs = (input: CameraInput) => [
  input.slug,
  input.name,
  input.make,
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
        `INSERT INTO cameras (slug, name, make, model, kind, description, product_url)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(...cameraArgs(input))
      .first<RawCameraRow>();
    if (!raw) throw new Error("INSERT INTO cameras returned no row");
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
        `UPDATE cameras SET slug = ?, name = ?, make = ?, model = ?, kind = ?,
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
      "SELECT * FROM camera_images WHERE camera_id = ? ORDER BY position, id",
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
        `INSERT INTO camera_images (camera_id, file, caption, position)
         VALUES (?1, ?2, ?3,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_images WHERE camera_id = ?1))
         RETURNING *`,
      )
      .bind(cameraId, image.file, image.caption)
      .first<CameraImageRow>();
    if (!row) throw new Error("INSERT INTO camera_images returned no row");
    return row;
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed: camera_images\./.test(err.message)
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
      "UPDATE camera_images SET caption = ? WHERE id = ? AND camera_id = ?",
    )
    .bind(caption, imageId, cameraId)
    .run();
  return (res.meta.changes ?? 0) > 0;
};

export const removeCameraImage = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
): Promise<boolean> => {
  const res = await db
    .prepare("DELETE FROM camera_images WHERE id = ? AND camera_id = ?")
    .bind(imageId, cameraId)
    .run();
  return (res.meta.changes ?? 0) > 0;
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
  await db.batch(
    order.map((id, position) =>
      db
        .prepare(
          "UPDATE camera_images SET position = ? WHERE id = ? AND camera_id = ?",
        )
        .bind(position, id, cameraId),
    ),
  );
  return true;
};

// Cap on rows pulled in a single export query. D1 caps result sets at ~10 MB;
// at ~200 bytes/row this leaves plenty of headroom but trips a clear error
// before we hit the opaque platform limit. Switch to cursor-based batching
// here if the gallery ever approaches this scale.
//
// Note: the check fires *after* `.all()` materialises the rows. If the result
// set blows the D1 size limit the platform error surfaces first; this guard
// is only useful for catching the "you forgot to add cursor batching" case
// while still under the hard cap. A `SELECT COUNT(*)` pre-flight would catch
// it earlier but doubles the publish-path queries.
// TODO: switch to cursor-based batching when the gallery approaches ~5k rows.
const MAX_EXPORT_ROWS = 50_000;

export type ExportSnapshot = {
  media: MediaInfoJSON[];
  cameras: CameraJSON[];
};

/**
 * media.json + cameras.json from already-loaded rows. Media keep the given
 * order; cameras are sorted by slug so the file diffs cleanly, and each
 * camera's images by position.
 */
export const buildExport = (
  mediaRows: MediaRow[],
  cameraRows: CameraRow[],
  imageRows: CameraImageRow[] = [],
): ExportSnapshot => {
  const byId = new Map(cameraRows.map((c) => [c.id, c]));
  const imagesOf = new Map<number, CameraImageRow[]>();
  for (const img of [...imageRows].sort(
    (a, b) => a.position - b.position || a.id - b.id,
  )) {
    imagesOf.set(img.camera_id, [...(imagesOf.get(img.camera_id) ?? []), img]);
  }
  return {
    media: mediaRows.map((r) => rowToMediaJson(r, byId)),
    cameras: [...cameraRows]
      .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .map((c) => cameraToJson(c, imagesOf.get(c.id))),
  };
};

export const exportSnapshot = async (
  db: D1Database,
): Promise<ExportSnapshot> => {
  // One batch = one transaction, so media never references a camera the
  // cameras query did not see.
  const [mediaRes, cameraRes, imageRes] = await db.batch([
    db.prepare(
      "SELECT * FROM media ORDER BY timestamp IS NULL, timestamp DESC, id DESC",
    ),
    db.prepare("SELECT * FROM cameras"),
    db.prepare("SELECT * FROM camera_images"),
  ]);
  const rows = (mediaRes.results ?? []) as RawRow[];
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Error(
      `media export exceeded ${MAX_EXPORT_ROWS} rows (got ${rows.length}); switch to cursor-based batching`,
    );
  }
  return buildExport(
    rows.map(rowToMedia),
    ((cameraRes.results ?? []) as RawCameraRow[]).map(rowToCamera),
    (imageRes.results ?? []) as CameraImageRow[],
  );
};
