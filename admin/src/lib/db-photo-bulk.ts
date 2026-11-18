// Setting the camera or the platform of several photos at once (the Files
// view's selection, the camera page), with what each had before for the
// undo (db-photo-bulk.spec.ts, on the real schema).

import { LIVE_PHOTO, type MediaPlatform } from "./types";

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

/** A photo's camera before a bulk change. */
export type PreviousCamera = { id: number; camera_id: number | null };

// One JSON array of [id, camera_id] pairs (D1 caps bound parameters at 100).
const SET_CAMERAS_SQL = `UPDATE media SET
   camera_id = (SELECT json_extract(value, '$[1]') FROM json_each(?1)
                WHERE json_extract(value, '$[0]') = media.id),
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`;

const writeCameras = async (
  db: D1Database,
  rows: readonly PreviousCamera[],
): Promise<void> => {
  if (rows.length === 0) return;
  await db
    .prepare(SET_CAMERAS_SQL)
    .bind(JSON.stringify(rows.map((r) => [r.id, r.camera_id])))
    .run();
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
        `SELECT id, camera_id FROM media
         WHERE id IN (SELECT value FROM json_each(?1))
           AND camera_id IS NOT ?2
         ORDER BY id`,
      )
      .bind(json, cameraId),
    db
      .prepare(
        `UPDATE media SET camera_id = ?2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT value FROM json_each(?1))
           AND camera_id IS NOT ?2`,
      )
      .bind(json, cameraId),
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
  ]);
  return before.results ?? [];
};

/** Undo of setPlatforms: each photo back to its platform. */
export const restorePlatforms = async (
  db: D1Database,
  previous: readonly PreviousPlatform[],
): Promise<void> => {
  if (previous.length === 0) return;
  await db
    .prepare(
      `UPDATE media SET
         platform = (SELECT json_extract(value, '$[1]') FROM json_each(?1)
                     WHERE json_extract(value, '$[0]') = media.id),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`,
    )
    .bind(JSON.stringify(previous.map((p) => [p.id, p.platform])))
    .run();
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
        `SELECT id, camera_id FROM media
         WHERE id IN (SELECT value FROM json_each(?1)) AND camera_id = ?2
         ORDER BY id`,
      )
      .bind(json, cameraId),
    db
      .prepare(
        `UPDATE media SET camera_id = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT value FROM json_each(?1)) AND camera_id = ?2`,
      )
      .bind(json, cameraId),
  ]);
  return before.results ?? [];
};
