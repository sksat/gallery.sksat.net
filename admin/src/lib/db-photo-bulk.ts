// Setting the camera, the platform or the tags and shooting data of
// several photos at once (the Files view's selection, the camera page),
// with what each had before for the undo (db-photo-bulk.spec.ts, on the
// real schema). Each write bumps the API's content version (last-good.ts)
// in the same D1 batch.

import {
  applyInfo,
  INFO_COLUMNS,
  infoChanged,
  infoProblem,
  infoValues,
  sourcePatch,
  type InfoEdit,
  type InfoRow,
  type InfoValues,
} from "./bulk-info";
import { ensureTags } from "./db-meta";
import { contentVersionStatement } from "./last-good";
import { LIVE_PHOTO, type MediaPlatform } from "./types";

const INFO_SELECT = `id, ${INFO_COLUMNS.join(", ")}`;
const INFO_UPDATE = `UPDATE media SET ${INFO_COLUMNS.map((c) => `${c} = ?`).join(", ")},
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`;

/** Only while the row still has `was` (changed meanwhile: left alone). */
const INFO_UPDATE_IF = `${INFO_UPDATE} AND ${INFO_COLUMNS.map((c) => `${c} IS ?`).join(" AND ")}`;

const RESTORED_COLUMNS = INFO_COLUMNS.filter((c) => c !== "metadata_source");

/**
 * The undo's UPDATE: the columns as they were, and in metadata_source only
 * the keys of the fields this sheet writes (sourcePatch), so a mark set
 * since by another edit (e.g. digitized_with) stays.
 */
const INFO_RESTORE = `UPDATE media SET ${RESTORED_COLUMNS.map((c) => `${c} = ?`).join(", ")},
   metadata_source = NULLIF(json_patch(COALESCE(metadata_source, '{}'), ?), '{}'),
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`;

const writeInfo = async (
  db: D1Database,
  rows: readonly InfoRow[],
): Promise<void> => {
  if (rows.length === 0) return;
  // One batch (a transaction): every photo or none.
  await db.batch(
    rows.map((r) =>
      db
        .prepare(INFO_RESTORE)
        .bind(
          ...RESTORED_COLUMNS.map((c) => r[c]),
          sourcePatch(r.metadata_source),
          r.id,
        ),
    ),
  );
};

export class InfoEditError extends Error {}

/**
 * Apply `edit` (bulk-info.ts) to photos `ids`. Returns what each changed
 * photo had before (for the undo) and the tags that were new to the site
 * (they become private, as on the edit page).
 */
export const setInfo = async (
  db: D1Database,
  ids: readonly number[],
  edit: InfoEdit,
): Promise<{ previous: InfoRow[]; newTags: string[] }> => {
  if (ids.length === 0) return { previous: [], newTags: [] };
  const res = await db
    .prepare(
      `SELECT ${INFO_SELECT} FROM media
       WHERE id IN (SELECT value FROM json_each(?)) AND ${LIVE_PHOTO}
       ORDER BY id`,
    )
    .bind(JSON.stringify(ids))
    .all<InfoRow>();
  const changes: { before: InfoRow; after: InfoRow }[] = [];
  for (const before of res.results ?? []) {
    const after = applyInfo(before, edit);
    if (!infoChanged(before, after)) continue;
    // Nothing is written when any photo cannot take the tags it gets (its
    // tags are checked only when this edit changes them).
    const problem = after.tags !== before.tags ? infoProblem(after) : null;
    if (problem) throw new InfoEditError(`${before.id}: ${problem}`);
    changes.push({ before, after });
  }
  if (changes.length === 0) return { previous: [], newTags: [] };
  // Each row only if nobody changed it since it was read, so the undo is
  // exactly what was replaced.
  const results = await db.batch(
    changes.map(({ before, after }) =>
      db
        .prepare(INFO_UPDATE_IF)
        .bind(
          ...INFO_COLUMNS.map((c) => after[c]),
          after.id,
          ...INFO_COLUMNS.map((c) => before[c]),
        ),
    ),
  );
  const previous = changes
    .filter((_, i) => (results[i]?.meta?.changes ?? 0) > 0)
    .map((c) => c.before);
  const newTags =
    previous.length > 0 && edit.tagsAdd
      ? await ensureTags(db, edit.tagsAdd)
      : [];
  return { previous, newTags };
};

/**
 * What the タグと撮影データ sheet shows for photos `ids` (listed ones), and
 * the site's tags to pick from (from the `tag` table, which every tag used
 * since tags became public one by one has).
 */
export const listInfo = async (
  db: D1Database,
  ids: readonly number[],
): Promise<{ photos: InfoValues[]; tags: { name: string; public: boolean }[] }> => {
  const [photos, tags] = await db.batch<InfoRow | { name: string; public: number }>([
    db
      .prepare(
        `SELECT ${INFO_SELECT} FROM media
         WHERE id IN (SELECT value FROM json_each(?)) AND ${LIVE_PHOTO}
         ORDER BY id`,
      )
      .bind(JSON.stringify(ids)),
    db.prepare("SELECT name, public FROM tag ORDER BY name"),
  ]);
  return {
    photos: ((photos.results ?? []) as InfoRow[]).map(infoValues),
    tags: ((tags.results ?? []) as { name: string; public: number }[]).map(
      (t) => ({ name: t.name, public: t.public === 1 }),
    ),
  };
};

/** Undo of setInfo: each photo's columns as they were. */
export const restoreInfo = (
  db: D1Database,
  previous: readonly InfoRow[],
): Promise<void> => writeInfo(db, previous);

/** A camera to pick: its name and its first picture, if any. */
export type CameraChoice = { id: number; name: string; image: string | null };

export const listCameraChoices = async (
  db: D1Database,
): Promise<CameraChoice[]> => {
  const res = await db
    .prepare(
      `SELECT c.id, c.name,
         (SELECT file FROM camera_image i WHERE i.camera_id = c.id
          ORDER BY i.position, i.id LIMIT 1) AS image
       FROM camera c ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .all<CameraChoice>();
  return res.results ?? [];
};

/**
 * A photo's camera before a bulk change, and where it came from
 * (metadata_source.camera: 'manual', 'file' or none).
 */
export type PreviousCamera = {
  id: number;
  camera_id: number | null;
  camera_source: "manual" | "file" | null;
};

/** What the reads return: the camera and its source key. */
const PREVIOUS_CAMERA = `id, camera_id,
  json_extract(metadata_source, '$.camera') AS camera_source`;

/**
 * A camera set or taken off here is chosen by hand: the metadata reader
 * never links one again (metadata_source.camera, as on the edit page).
 */
const CAMERA_MANUAL = `metadata_source = json_set(COALESCE(metadata_source, '{}'), '$.camera', 'manual')`;

// One JSON array of [id, camera_id, camera_source] (D1 caps bound
// parameters at 100). The source key goes back as it was (json_patch: a
// null removes it), every other key of metadata_source kept.
const SET_CAMERAS_SQL = `UPDATE media SET
   camera_id = (SELECT json_extract(value, '$[1]') FROM json_each(?1)
                WHERE json_extract(value, '$[0]') = media.id),
   metadata_source = NULLIF(json_patch(COALESCE(metadata_source, '{}'),
     json_object('camera', (SELECT json_extract(value, '$[2]') FROM json_each(?1)
                            WHERE json_extract(value, '$[0]') = media.id))), '{}'),
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`;

const writeCameras = async (
  db: D1Database,
  rows: readonly PreviousCamera[],
): Promise<void> => {
  if (rows.length === 0) return;
  await db.batch([
    db
      .prepare(SET_CAMERAS_SQL)
      .bind(
        JSON.stringify(rows.map((r) => [r.id, r.camera_id, r.camera_source])),
      ),
    contentVersionStatement(db),
  ]);
};

export class UnknownCameraError extends Error {}

/**
 * Give photos `ids` camera `cameraId` (null: none). Photos that already
 * have it are left alone; returns what each changed photo had.
 */
export const setCameras = async (
  db: D1Database,
  ids: readonly number[],
  cameraId: number | null,
): Promise<PreviousCamera[]> => {
  if (ids.length === 0) return [];
  if (cameraId !== null) {
    const cam = await db
      .prepare("SELECT 1 AS ok FROM camera WHERE id = ?")
      .bind(cameraId)
      .first<{ ok: number }>();
    if (!cam) throw new UnknownCameraError(`no camera ${cameraId}`);
  }
  // Read and write in one batch (a transaction): the undo is exactly what
  // the update replaced.
  const json = JSON.stringify(ids);
  const [before] = await db.batch<PreviousCamera>([
    db
      .prepare(
        `SELECT ${PREVIOUS_CAMERA} FROM media
         WHERE id IN (SELECT value FROM json_each(?1))
           AND camera_id IS NOT ?2
         ORDER BY id`,
      )
      .bind(json, cameraId),
    db
      .prepare(
        `UPDATE media SET camera_id = ?2, ${CAMERA_MANUAL},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT value FROM json_each(?1))
           AND camera_id IS NOT ?2`,
      )
      .bind(json, cameraId),
    contentVersionStatement(db),
  ]);
  return before.results ?? [];
};

/**
 * Undo of setCameras: each photo back to its camera. A camera deleted
 * meanwhile (none can be today) would fail the foreign key.
 */
export const restoreCameras = (
  db: D1Database,
  previous: readonly PreviousCamera[],
): Promise<void> => writeCameras(db, previous);

/** A photo's platform before a bulk change. */
export type PreviousPlatform = { id: number; platform: MediaPlatform };

/**
 * Give photos `ids` platform `platform` (validated by the caller). Photos
 * that already have it are left alone; returns what each changed one had,
 * read in the same batch as the update.
 */
export const setPlatforms = async (
  db: D1Database,
  ids: readonly number[],
  platform: MediaPlatform,
): Promise<PreviousPlatform[]> => {
  if (ids.length === 0) return [];
  const json = JSON.stringify(ids);
  const [before] = await db.batch<PreviousPlatform>([
    db
      .prepare(
        `SELECT id, platform FROM media
         WHERE id IN (SELECT value FROM json_each(?1)) AND platform <> ?2
         ORDER BY id`,
      )
      .bind(json, platform),
    db
      .prepare(
        `UPDATE media SET platform = ?2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT value FROM json_each(?1)) AND platform <> ?2`,
      )
      .bind(json, platform),
    contentVersionStatement(db),
  ]);
  return before.results ?? [];
};

/** Undo of setPlatforms: each photo back to its platform. */
export const restorePlatforms = async (
  db: D1Database,
  previous: readonly PreviousPlatform[],
): Promise<void> => {
  if (previous.length === 0) return;
  await db.batch([
    db
      .prepare(
        `UPDATE media SET
           platform = (SELECT json_extract(value, '$[1]') FROM json_each(?1)
                       WHERE json_extract(value, '$[0]') = media.id),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`,
      )
      .bind(JSON.stringify(previous.map((p) => [p.id, p.platform]))),
    contentVersionStatement(db),
  ]);
};

/** A photo on the camera page. */
export type CameraPhoto = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: string;
  timestamp: string | null;
};

/** The listed photos taken with camera `cameraId`, newest first. */
export const listCameraPhotos = async (
  db: D1Database,
  cameraId: number,
): Promise<CameraPhoto[]> => {
  const res = await db
    .prepare(
      `SELECT id, file, path, platform, visibility, timestamp FROM media
       WHERE camera_id = ? AND ${LIVE_PHOTO}
       ORDER BY timestamp IS NULL, timestamp DESC, id DESC`,
    )
    .bind(cameraId)
    .all<CameraPhoto>();
  return res.results ?? [];
};

/**
 * Take camera `cameraId` off photos `ids` (only those that have it);
 * returns what changed, for restoreCameras.
 */
export const removeCameraFrom = async (
  db: D1Database,
  cameraId: number,
  ids: readonly number[],
): Promise<PreviousCamera[]> => {
  if (ids.length === 0) return [];
  const json = JSON.stringify(ids);
  const [before] = await db.batch<PreviousCamera>([
    db
      .prepare(
        `SELECT ${PREVIOUS_CAMERA} FROM media
         WHERE id IN (SELECT value FROM json_each(?1)) AND camera_id = ?2
         ORDER BY id`,
      )
      .bind(json, cameraId),
    db
      .prepare(
        `UPDATE media SET camera_id = NULL, ${CAMERA_MANUAL},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT value FROM json_each(?1)) AND camera_id = ?2`,
      )
      .bind(json, cameraId),
    contentVersionStatement(db),
  ]);
  return before.results ?? [];
};
