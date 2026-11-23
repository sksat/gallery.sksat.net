import {
  parseLevelMap,
  parseTagVisibility,
  parseValueMap,
} from "@shared/tag-field/tag-field";
import { TAKEN_ON_SQL, takenOnArgs } from "./calendar";
import { contentVersionStatement } from "./last-good";
import { parseOverrides } from "./metadata";
import { parseSources } from "./metadata-source";
import { mergeExif, parseExifColumn } from "./photo-data";
import { normalizeFileExif, parseVrcxColumn } from "./photo-meta";
import {
  CAMERA_KINDS,
  type CameraImageItem,
  type CameraImageRow,
  type CameraInput,
  type CameraKind,
  type CameraRow,
  type MediaPatch,
  type MediaRow,
  type MediaPlatform,
  isVisibility,
  LIVE_PHOTO,
  type Visibility,
} from "./types";

type RawRow = {
  id: number;
  public_id: string;
  file: string;
  /** NULL only before migration 0005 / in hand-written test tables. */
  path?: string | null;
  platform: string;
  timestamp: string | null;
  camera_id: number | null;
  tags: string;
  visibility: string;
  metadata_visibility?: string | null;
  exif?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_source?: string | null;
  world_id?: string | null;
  world_name?: string | null;
  photographer_id?: string | null;
  photographer_name?: string | null;
  vrcx?: string | null;
  trashed_at?: string | null;
  metadata_source?: string | null;
  file_exif?: string | null;
  digitized_at?: string | null;
  digitized_with?: number | null;
  embed_exif?: number | null;
  tag_values?: string | null;
  tag_value_visibility?: string | null;
  tag_visibility?: string | null;
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
  // media.platform REFERENCES platform (0014): any key there.
  if (!isVisibility(raw.visibility)) {
    throw new Error(`unknown visibility value in DB: ${raw.visibility}`);
  }
  return {
    id: raw.id,
    public_id: raw.public_id,
    file: raw.file,
    path: raw.path ?? raw.file,
    platform: raw.platform,
    timestamp: raw.timestamp,
    camera_id: raw.camera_id,
    tags: parseTags(raw.tags),
    visibility: raw.visibility,
    metadata_visibility: parseOverrides(raw.metadata_visibility),
    exif: parseExifColumn(raw.exif),
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    location_source:
      raw.location_source === "exif" || raw.location_source === "manual"
        ? raw.location_source
        : null,
    world_id: raw.world_id ?? null,
    world_name: raw.world_name ?? null,
    photographer:
      raw.photographer_id || raw.photographer_name
        ? {
            id: raw.photographer_id ?? null,
            name: raw.photographer_name ?? null,
          }
        : null,
    vrcx: parseVrcxColumn(raw.vrcx),
    trashed_at: raw.trashed_at ?? null,
    metadata_source: parseSources(raw.metadata_source),
    file_exif: parseFileExifColumn(raw.file_exif),
    digitized_at: raw.digitized_at ?? null,
    digitized_with: raw.digitized_with ?? null,
    embed_exif:
      raw.embed_exif === 1 ? true : raw.embed_exif === 0 ? false : null,
    tag_values: parseValueMap(raw.tag_values),
    tag_value_visibility: parseLevelMap(raw.tag_value_visibility),
    tag_visibility: parseTagVisibility(raw.tag_visibility),
    updated_at: raw.updated_at,
  };
};

const parseFileExifColumn = (raw: string | null | undefined) => {
  if (!raw) return null;
  try {
    return normalizeFileExif(JSON.parse(raw));
  } catch {
    return null;
  }
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
  platform?: MediaPlatform;
  visibility?: Visibility;
  q?: string;
  /** Taken in this year, month or day (YYYY[-MM[-DD]], the calendar). */
  date?: string;
  limit: number;
  offset: number;
};

/** A row of the list view: the photo and its camera's name. */
export type MediaListRow = MediaRow & {
  /** `camera.name` of its camera (`camera_id`), or null without one. */
  camera_name: string | null;
};

export type ListResult = {
  rows: MediaListRow[];
  total: number;
};

export const listMedia = async (
  db: D1Database,
  params: ListParams,
): Promise<ListResult> => {
  // Not uploads that have not completed, nor the trash.
  const where: string[] = [LIVE_PHOTO];
  const args: unknown[] = [];
  if (params.platform) {
    where.push("platform = ?");
    args.push(params.platform);
  }
  if (params.visibility) {
    where.push("visibility = ?");
    args.push(params.visibility);
  }
  if (params.q) {
    // Escape LIKE metacharacters so a literal `%` or `_` in the query does
    // not behave as a wildcard. Searches where photos are shown (path).
    const escaped = params.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("path LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  if (params.date) {
    where.push(TAKEN_ON_SQL);
    args.push(...takenOnArgs(params.date));
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  // With a date there are no undated rows: the plain index order lets the
  // range stop at LIMIT + OFFSET instead of sorting the whole range.
  const order = params.date
    ? "timestamp DESC, id DESC"
    : "timestamp IS NULL, timestamp DESC, id DESC";

  // The camera's name is joined to the page only: a join on media itself
  // would look up the camera of every matching row before the sort (D1
  // counts each lookup), this one at most a page's. The outer sort is of
  // that page alone.
  const rowsStmt = db
    .prepare(
      `SELECT m.*, c.name AS camera_name
       FROM (SELECT ${LIST_COLUMNS} FROM media ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?) AS m
       LEFT JOIN camera AS c ON c.id = m.camera_id
       ORDER BY m.timestamp IS NULL, m.timestamp DESC, m.id DESC`,
    )
    .bind(...args, params.limit, params.offset);
  const countStmt = db
    .prepare(`SELECT COUNT(*) AS c FROM media ${whereSql}`)
    .bind(...args);

  const [rowsRes, countRes] = await Promise.all([
    rowsStmt.all<RawRow & { camera_name: string | null }>(),
    countStmt.first<{ c: number }>(),
  ]);

  return {
    rows: (rowsRes.results ?? []).map((r) => ({
      ...rowToMedia(r),
      camera_name: r.camera_name ?? null,
    })),
    total: countRes?.c ?? 0,
  };
};

/**
 * What a list reads of each photo: every column rowToMedia uses except
 * media.vrcx, whose players are for the edit page only (up to a hundred
 * names per photo, for nothing, on every list page).
 */
const LIST_COLUMNS = [
  "id",
  "public_id",
  "file",
  "path",
  "platform",
  "timestamp",
  "camera_id",
  "tags",
  "visibility",
  "metadata_visibility",
  "exif",
  "latitude",
  "longitude",
  "location_source",
  "world_id",
  "world_name",
  "photographer_id",
  "photographer_name",
  "trashed_at",
  "metadata_source",
  "file_exif",
  "digitized_at",
  "digitized_with",
  "embed_exif",
  "tag_values",
  "tag_value_visibility",
  "tag_visibility",
  "updated_at",
].join(", ");

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
  /** Fields edited by hand here (metadata_source → 'manual'). */
  const manual: (
    "exif" | "world" | "taken_at" | "digitized_with" | "camera"
  )[] = [];
  const args: unknown[] = [];
  if (patch.platform !== undefined) {
    sets.push("platform = ?");
    args.push(patch.platform);
  }
  if (patch.camera_id !== undefined) {
    sets.push("camera_id = ?");
    args.push(patch.camera_id);
  }
  if (patch.embed_exif !== undefined) {
    sets.push("embed_exif = ?");
    args.push(patch.embed_exif === null ? null : patch.embed_exif ? 1 : 0);
  }
  // Manual only when it really changes (a PATCH may echo the values).
  if (patch.timestamp !== undefined) {
    sets.push("timestamp = ?");
    args.push(patch.timestamp);
  }
  if (patch.digitized_with !== undefined) {
    sets.push("digitized_with = ?");
    args.push(patch.digitized_with);
  }
  if (
    patch.timestamp !== undefined ||
    patch.digitized_with !== undefined ||
    patch.camera_id !== undefined
  ) {
    const was = await db
      .prepare(
        "SELECT timestamp, digitized_with, camera_id FROM media WHERE id = ?",
      )
      .bind(id)
      .first<{
        timestamp: string | null;
        digitized_with: number | null;
        camera_id: number | null;
      }>();
    if (!was) return null;
    if (patch.timestamp !== undefined && patch.timestamp !== was.timestamp) {
      manual.push("taken_at");
    }
    if (
      patch.digitized_with !== undefined &&
      patch.digitized_with !== was.digitized_with
    ) {
      manual.push("digitized_with");
    }
    // A camera chosen or cleared by hand: the reader never links one.
    if (patch.camera_id !== undefined && patch.camera_id !== was.camera_id) {
      manual.push("camera");
    }
  }
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    args.push(JSON.stringify(patch.tags));
  }
  if (patch.visibility !== undefined) {
    sets.push("visibility = ?");
    args.push(patch.visibility);
  }
  if (patch.metadata_visibility !== undefined) {
    sets.push("metadata_visibility = ?");
    args.push(
      Object.keys(patch.metadata_visibility).length > 0
        ? JSON.stringify(patch.metadata_visibility)
        : null,
    );
  }
  // The stored shooting data, when the patch edits it.
  const current =
    patch.exif !== undefined || patch.world !== undefined
      ? await db
          .prepare("SELECT exif, world_id, world_name FROM media WHERE id = ?")
          .bind(id)
          .first<{
            exif: string | null;
            world_id: string | null;
            world_name: string | null;
          }>()
      : null;
  if (patch.exif !== undefined) {
    // The keys the page does not edit (orientation, the original's time)
    // stay as read from the file.
    if (!current) return null;
    const merged = mergeExif(current.exif, patch.exif);
    if (merged !== current.exif) {
      sets.push("exif = ?");
      args.push(merged);
      manual.push("exif");
    }
  }
  if (patch.location !== undefined) {
    const lat = patch.location?.latitude ?? null;
    const lon = patch.location?.longitude ?? null;
    // Unchanged: as it was (from EXIF stays EXIF). Changed by hand, cleared
    // included: manual, so reading the file again never brings it back.
    const same = "latitude IS ? AND longitude IS ?";
    sets.push(
      `location_source = CASE WHEN ${same} THEN location_source
         ELSE 'manual' END`,
      `latitude = CASE WHEN ${same} THEN latitude ELSE ? END`,
      `longitude = CASE WHEN ${same} THEN longitude ELSE ? END`,
    );
    args.push(lat, lon, lat, lon, lat, lat, lon, lon);
  }
  if (patch.world !== undefined) {
    // The photographer (0015) is not the world's: it stays.
    if (patch.world.id !== undefined) {
      sets.push("world_id = ?");
      args.push(patch.world.id);
    }
    if (patch.world.name !== undefined) {
      sets.push("world_name = ?");
      args.push(patch.world.name);
    }
    // Manual only when it really changes (a PATCH may echo the values).
    if (
      current &&
      ((patch.world.id !== undefined && patch.world.id !== current.world_id) ||
        (patch.world.name !== undefined &&
          patch.world.name !== current.world_name))
    ) {
      manual.push("world");
    }
  }
  // Back to what the file says: the field emptied and its source dropped,
  // and the photo marked unread, so the reader fills it from the file.
  const reset = new Set(patch.reset_from_file ?? []);
  if (reset.has("exif")) sets.push("exif = NULL");
  if (reset.has("taken_at")) sets.push("timestamp = NULL");
  if (reset.has("world")) {
    sets.push("world_id = NULL", "world_name = NULL");
  }
  if (reset.has("location")) {
    sets.push("latitude = NULL", "longitude = NULL", "location_source = NULL");
  }
  // A field entered by hand is never replaced by a reading of the file
  // (metadata-source.ts); a reset one is open to it again.
  const sourceKeys = [
    ...manual
      .filter((f) => !(reset as Set<string>).has(f))
      .map((f) => [f, "manual"] as const),
  ];
  const removed = [...reset].filter((f) => f !== "location");
  if (sourceKeys.length > 0 || removed.length > 0) {
    let expr = "COALESCE(metadata_source, '{}')";
    for (const f of removed) expr = `json_remove(${expr}, '$.${f}')`;
    for (const [f, v] of sourceKeys)
      expr = `json_set(${expr}, '$.${f}', '${v}')`;
    sets.push(`metadata_source = NULLIF(${expr}, '{}')`);
  }
  // Waiting to be read again: as never read when the location is reset
  // (an empty one is filled only then), else as read long ago, so a
  // location cleared by hand before 0008 stays cleared.
  if (reset.has("location")) sets.push("metadata_read_at = NULL");
  else if (reset.size > 0) {
    sets.push("metadata_read_at = '2000-01-01T00:00:00.000Z'");
  }
  // Tag field values and levels: a JSON merge patch (null removes a key),
  // so ids left out keep what they have; none left is NULL.
  for (const column of ["tag_values", "tag_value_visibility"] as const) {
    const p = patch[column];
    if (p === undefined || Object.keys(p).length === 0) continue;
    sets.push(
      `${column} = NULLIF(json_patch(COALESCE(${column}, '{}'), ?), '{}')`,
    );
    args.push(JSON.stringify(p));
  }
  // The photo's choices per tag (0021), merged the same way. When its tags
  // change, only the choices for tags it still has (its own and its
  // camera's, as saved) are kept: a tag taken off and put on again later
  // starts from the tag's own setting.
  const tv = patch.tag_visibility;
  if ((tv !== undefined && Object.keys(tv).length > 0) || patch.tags) {
    const merged =
      tv !== undefined && Object.keys(tv).length > 0
        ? "json_patch(COALESCE(tag_visibility, '{}'), ?)"
        : "tag_visibility";
    if (merged !== "tag_visibility") args.push(JSON.stringify(tv));
    if (patch.tags) {
      const camera = patch.camera_id !== undefined ? "?" : "media.camera_id";
      sets.push(
        `tag_visibility = (
           SELECT NULLIF(json_group_object(j.key, j.value), '{}')
           FROM json_each(COALESCE(${merged}, '{}')) j
           WHERE j.key IN (SELECT value FROM json_each(?))
              OR j.key IN (SELECT tag FROM camera_tag
                           WHERE camera_id = ${camera} AND propagate = 1))`,
      );
      args.push(JSON.stringify(patch.tags));
      if (patch.camera_id !== undefined) args.push(patch.camera_id);
    } else {
      sets.push(`tag_visibility = NULLIF(${merged}, '{}')`);
    }
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

/** A camera with how many photos were shot / digitised (スキャン) with it. */
export type CameraListItem = CameraRow & {
  photo_count: number;
  digitized_count: number;
};

export const listCameras = async (
  db: D1Database,
): Promise<CameraListItem[]> => {
  const res = await db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM media m WHERE m.camera_id = c.id AND m.status = 'ready' AND m.trashed_at IS NULL) AS photo_count,
         (SELECT COUNT(*) FROM media m WHERE m.digitized_with = c.id AND m.status = 'ready' AND m.trashed_at IS NULL) AS digitized_count
       FROM camera c ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .all<RawCameraRow & { photo_count: number; digitized_count: number }>();
  return (res.results ?? []).map((r) => ({
    ...rowToCamera(r),
    photo_count: r.photo_count,
    digitized_count: r.digitized_count,
  }));
};

export type CameraOption = {
  id: number;
  name: string;
  slug: string;
  kind: string | null;
};

/** The cameras for a <select>, sorted like listCameras, without counts. */
export const listCameraOptions = async (
  db: D1Database,
): Promise<CameraOption[]> => {
  const res = await db
    .prepare(
      "SELECT id, name, slug, kind FROM camera ORDER BY name COLLATE NOCASE, id",
    )
    .all<CameraOption>();
  return res.results ?? [];
};

/** The スキャン機材 <select>'s order: scanners first, then the rest. */
export const digitizerOptions = (cameras: CameraOption[]): CameraOption[] => [
  ...cameras.filter((c) => c.kind === "scanner"),
  ...cameras.filter((c) => c.kind !== "scanner"),
];

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

/** A camera's pictures in display order, a photo's with its photo. */
export const listCameraImages = async (
  db: D1Database,
  cameraId: number,
): Promise<CameraImageItem[]> => {
  const res = await db
    .prepare(
      `SELECT i.*, m.file AS photo_file, m.path AS photo_path,
         m.visibility AS photo_visibility,
         (m.status = 'ready' AND m.trashed_at IS NULL) AS photo_live
       FROM camera_image i LEFT JOIN media m ON m.id = i.media_id
       WHERE i.camera_id = ? ORDER BY i.position, i.id`,
    )
    .bind(cameraId)
    .all<
      CameraImageRow & {
        photo_file: string | null;
        photo_path: string | null;
        photo_visibility: Visibility | null;
        photo_live: number | null;
      }
    >();
  return (res.results ?? []).map(
    ({ photo_file, photo_path, photo_visibility, photo_live, ...row }) => ({
      ...row,
      photo:
        row.media_id !== null && photo_file !== null
          ? {
              file: photo_file,
              path: photo_path ?? photo_file,
              visibility: photo_visibility ?? "private",
              live: photo_live === 1,
            }
          : null,
    }),
  );
};

/** Thrown by addCameraImage when the camera already has that file. */
export class DuplicateImageError extends Error {
  constructor(file: string) {
    super(`image already added: ${file}`);
    this.name = "DuplicateImageError";
  }
}

/**
 * Thrown by addCameraImage while an upload or a 削除 holds the path
 * (db-camera-image.ts reservePictureName).
 */
export class PathBusyError extends Error {
  constructor(file: string) {
    super(`path in use by an upload or a deletion: ${file}`);
    this.name = "PathBusyError";
  }
}

/**
 * Append a picture after the camera's last one. Refused (PathBusyError),
 * in the same statement, while an upload or a 削除 holds the path, so a
 * picture never points at an object being deleted.
 */
export const addCameraImage = async (
  db: D1Database,
  cameraId: number,
  image: { file: string; caption: string | null },
): Promise<CameraImageRow> => {
  try {
    const row = await db
      .prepare(
        `INSERT INTO camera_image (camera_id, file, caption, position)
         SELECT ?1, ?2, ?3,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_image WHERE camera_id = ?1)
         WHERE ${PATH_FREE_SQL}
         RETURNING *`,
      )
      .bind(cameraId, image.file, image.caption)
      .first<CameraImageRow>();
    if (!row) throw new PathBusyError(image.file);
    return row;
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed: camera_image\./.test(err.message)
    ) {
      throw new DuplicateImageError(image.file);
    }
    throw photoFileError(err, image.file);
  }
};

/**
 * Thrown when a path given as a picture's own file is a photo's file
 * (0019's trigger): that photo is chosen as a photo instead, so that its
 * visibility decides whether the public site shows it.
 */
export class PhotoFileError extends Error {
  constructor(file: string) {
    super(`a photo's file: ${file}`);
    this.name = "PhotoFileError";
  }
}

const photoFileError = (err: unknown, file: string | null): unknown =>
  file !== null &&
  err instanceof Error &&
  /camera_image\.file is a photo's file/.test(err.message)
    ? new PhotoFileError(file)
    : err;

/**
 * A photo that may be a camera picture (0019): a public one (ready, not
 * in the trash), as the API Worker's PHOTO_PICTURE_SQL checks again when
 * serving it. Never an unlisted one: a camera page is public, and an
 * unlisted photo opens only by its own URL. `param` binds its id.
 */
const pickablePhotoSql = (param: string) => `SELECT 1 FROM media
  WHERE id = ${param} AND visibility = 'public' AND ${LIVE_PHOTO}`;

/** At most this many photos are added as pictures in one request. */
export const MAX_PICTURE_PHOTOS = 50;

/**
 * Add photos `mediaIds` as pictures after the camera's last one, in that
 * order, with the content version (one batch). A photo that is not public
 * (or in the trash, or not uploaded yet) or already a picture of the
 * camera is left out. Returns the new pictures' ids.
 */
export const addPhotoPictures = async (
  db: D1Database,
  cameraId: number,
  mediaIds: readonly number[],
): Promise<number[]> => {
  if (mediaIds.length === 0) return [];
  const results = await db.batch<{ id: number }>([
    ...mediaIds.map((mediaId) =>
      db
        .prepare(
          `INSERT INTO camera_image (camera_id, media_id, caption, position)
           SELECT ?1, ?2, NULL,
             (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_image WHERE camera_id = ?1)
           WHERE EXISTS (${pickablePhotoSql("?2")})
           ON CONFLICT (camera_id, media_id) DO NOTHING
           RETURNING id`,
        )
        .bind(cameraId, mediaId),
    ),
    contentVersionStatement(db),
  ]);
  return results
    .slice(0, mediaIds.length)
    .flatMap((r) => (r.results ?? []).map((x) => x.id));
};

/**
 * Undo of addPhotoPictures: those pictures off the camera again, with the
 * content version (one batch). Only photos' pictures.
 */
export const removePhotoPictures = async (
  db: D1Database,
  cameraId: number,
  imageIds: readonly number[],
): Promise<void> => {
  if (imageIds.length === 0) return;
  await db.batch([
    db
      .prepare(
        `DELETE FROM camera_image WHERE camera_id = ?1 AND media_id IS NOT NULL
           AND id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(cameraId, JSON.stringify(imageIds)),
    contentVersionStatement(db),
  ]);
};

/** A photo the picker offers (photo-picker.tsx). */
export type PickerPhoto = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  /** As stored (a Visibility). */
  visibility: string;
  timestamp: string | null;
};

/** The picker's page size. */
export const PICKER_PAGE = 40;

/**
 * One page of the listed photos under folder `dir` ("/" for all), by
 * path, after `after` (the last path of the page before, or ""): a range
 * of idx_media_path_live, so a page reads about PICKER_PAGE rows whatever
 * the library's size. One more row tells whether there is a next page.
 */
export const PICKER_PHOTOS_SQL = `SELECT id, file, path, platform, visibility, timestamp
  FROM media INDEXED BY idx_media_path_live
  WHERE trashed_at IS NULL AND path >= ?1 AND path < ?2 AND path > ?3
    AND +status = 'ready'
  ORDER BY path LIMIT ?4`;

export const listPickerPhotos = async (
  db: D1Database,
  dir: string,
  after: string,
): Promise<{ photos: PickerPhoto[]; more: boolean }> => {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  // Everything starting with the prefix: up to the prefix with its last
  // character's successor ("/" + 1 = "0").
  const end = prefix.slice(0, -1) + "0";
  const rows =
    (
      await db
        .prepare(PICKER_PHOTOS_SQL)
        .bind(prefix, end, after, PICKER_PAGE + 1)
        .all<PickerPhoto>()
    ).results ?? [];
  return {
    photos: rows.slice(0, PICKER_PAGE),
    more: rows.length > PICKER_PAGE,
  };
};

/**
 * SQL (binding ?2 to the file) that holds while no upload or 削除 holds
 * the path (db-camera-image.ts reservePictureName; also just after a
 * 削除, so an undo of an earlier 外す cannot bring back a deleted file).
 */
const PATH_FREE_SQL = `NOT EXISTS (SELECT 1 FROM setting
  WHERE key = 'camera_upload:' || ?2
    AND json_extract(value, '$.until') >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

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

/** A picture as its undo puts it back: its own file, or a photo (0019). */
export type PictureRef = {
  file: string | null;
  media_id: number | null;
  caption: string | null;
};

/**
 * Remove a picture. Returns what undo needs (its file or photo, caption
 * and index in the order), or null when this camera has no such picture.
 */
export const removeCameraImage = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
): Promise<(PictureRef & { index: number }) | null> => {
  const images = await listCameraImages(db, cameraId);
  const index = images.findIndex((img) => img.id === imageId);
  if (index === -1) return null;
  const res = await db
    .prepare("DELETE FROM camera_image WHERE id = ? AND camera_id = ?")
    .bind(imageId, cameraId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return null;
  const { file, media_id, caption } = images[index];
  return { file, media_id, caption, index };
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
  image: PictureRef,
  index: number,
): { sql: string; args: unknown[] }[] => {
  // The picture is the one row of the camera with this file and photo
  // (IS: one of them is NULL).
  const self = "file IS ?2 AND media_id IS ?5";
  return [
    {
      // A file only while no upload or 削除 holds its path; a photo only
      // while it may be a picture (no longer public meanwhile: not again).
      sql: `INSERT INTO camera_image (camera_id, file, media_id, caption, position)
     SELECT ?1, ?2, ?5, ?3, COALESCE(
       (SELECT position FROM camera_image WHERE camera_id = ?1
        ORDER BY position, id LIMIT 1 OFFSET ?4),
       (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_image
        WHERE camera_id = ?1))
     WHERE (?2 IS NULL OR ${PATH_FREE_SQL})
       AND (?5 IS NULL OR EXISTS (${pickablePhotoSql("?5")}))`,
      args: [
        cameraId,
        image.file,
        image.caption,
        Math.max(0, index),
        image.media_id,
      ],
    },
    {
      // The rows from `index` on (by position, then id, so ties keep their
      // order), the inserted one aside; only when it was inserted.
      sql: `UPDATE camera_image SET position = position + 1
     WHERE camera_id = ?1 AND NOT (${self}) AND (position, id) >=
       (SELECT position, id FROM camera_image WHERE camera_id = ?1 AND NOT (${self})
        ORDER BY position, id LIMIT 1 OFFSET ?3)
       AND EXISTS (SELECT 1 FROM camera_image WHERE camera_id = ?1 AND ${self})`,
      args: [cameraId, image.file, Math.max(0, index), null, image.media_id],
    },
  ];
};

/**
 * Thrown by restoreCameraImage when the photo of a removed picture may no
 * longer be one (no longer public, or in the trash, meanwhile).
 */
export class PhotoNotPickableError extends Error {
  constructor() {
    super("the photo is not public or gone");
    this.name = "PhotoNotPickableError";
  }
}

/**
 * Undo of a removal: add the picture back at `index` (0-based) of the
 * current order, in one batch. Throws DuplicateImageError if the file or
 * photo was added again meanwhile (and then changes nothing).
 */
export const restoreCameraImage = async (
  db: D1Database,
  cameraId: number,
  image: PictureRef,
  index: number,
): Promise<void> => {
  let inserted!: D1Result;
  try {
    [inserted] = await db.batch(
      restoreCameraImageStatements(cameraId, image, index).map(
        ({ sql, args }) => db.prepare(sql).bind(...args),
      ),
    );
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed: camera_image\./.test(err.message)
    ) {
      throw new DuplicateImageError(image.file ?? "the photo");
    }
    throw photoFileError(err, image.file);
  }
  // Nothing was inserted (nor moved): the file is held by an upload or a
  // 削除, or the photo may no longer be a picture.
  if ((inserted.meta.changes ?? 0) === 0) {
    throw image.file === null
      ? new PhotoNotPickableError()
      : new PathBusyError(image.file);
  }
};
