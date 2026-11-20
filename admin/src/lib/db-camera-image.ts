// D1 side of a camera's pictures beyond db.ts's add / remove / restore:
// their order (the first one is the default), the names an upload may
// take, and which objects may be deleted with their picture
// (db-camera-image.spec.ts).

import { numberedPaths, numberedRange } from "./db-upload";
import { contentVersionStatement } from "./last-good";
import { sameIds } from "./camera-image";

/** The camera's picture ids in display order. */
const imageIds = async (db: D1Database, cameraId: number) =>
  (
    (
      await db
        .prepare(
          "SELECT id FROM camera_image WHERE camera_id = ? ORDER BY position, id",
        )
        .bind(cameraId)
        .all<{ id: number }>()
    ).results ?? []
  ).map((r) => r.id);

export type OrderOutcome =
  | { kind: "ok"; previous: number[] }
  /** `order` is not an order of the camera's pictures (changed meanwhile). */
  | { kind: "stale" };

/**
 * Put the camera's pictures in `order` (positions 0..n-1, with the
 * content version, in one batch). Returns the order before, for 元に戻す.
 */
export const setCameraImageOrder = async (
  db: D1Database,
  cameraId: number,
  order: readonly number[],
): Promise<OrderOutcome> => {
  const previous = await imageIds(db, cameraId);
  if (!sameIds(previous, order)) return { kind: "stale" };
  if (previous.every((id, i) => order[i] === id)) {
    return { kind: "ok", previous };
  }
  // Each write only while the camera still has exactly these pictures (a
  // picture added or removed since the read above leaves them all
  // undone): the batch is one transaction, so they all see the same rows.
  const ids = JSON.stringify(order);
  const results = await db.batch([
    ...order.map((id, position) =>
      db
        .prepare(
          `UPDATE camera_image SET position = ?1 WHERE id = ?2 AND camera_id = ?3
             AND (SELECT COUNT(*) FROM camera_image WHERE camera_id = ?3) = ?4
             AND (SELECT COUNT(*) FROM camera_image WHERE camera_id = ?3
                  AND id IN (SELECT value FROM json_each(?5))) = ?4`,
        )
        .bind(position, id, cameraId, order.length, ids),
    ),
    contentVersionStatement(db),
  ]);
  const changed = results
    .slice(0, order.length)
    .reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return changed === order.length
    ? { kind: "ok", previous }
    : { kind: "stale" };
};

/**
 * The ids of the camera's pictures whose object something else uses too:
 * a photo's file (any of them, 0013) or another camera's picture.
 */
export const SHARED_IMAGES_SQL = `SELECT i.id FROM camera_image i
  WHERE i.camera_id = ?1 AND (
    EXISTS (SELECT 1 FROM media_file f
            WHERE f.storage = 'b2' AND f.object_key = i.file)
    OR EXISTS (SELECT 1 FROM camera_image o
               WHERE o.file = i.file AND o.id <> i.id))`;

export const sharedCameraImages = async (
  db: D1Database,
  cameraId: number,
): Promise<Set<number>> =>
  new Set(
    (
      (await db.prepare(SHARED_IMAGES_SQL).bind(cameraId).all<{ id: number }>())
        .results ?? []
    ).map((r) => r.id),
  );

/**
 * The bucket paths among `file` and its numbered names that a row
 * already uses: a camera picture (of any camera) or a photo's file. As
 * ranges, like the photo upload's lookups (db-upload.ts initLookups).
 */
export const takenPictureNames = async (
  db: D1Database,
  file: string,
): Promise<{ candidates: string[]; taken: Set<string> }> => {
  const [lo, hi] = numberedRange(file);
  const results = await db.batch<{ file: string }>([
    db
      .prepare(
        "SELECT file FROM camera_image WHERE file = ?1 OR (file >= ?2 AND file < ?3)",
      )
      .bind(file, lo, hi),
    db
      .prepare(
        "SELECT object_key AS file FROM media_file WHERE storage = 'b2' AND object_key = ?",
      )
      .bind(file),
    db
      .prepare(
        "SELECT object_key AS file FROM media_file WHERE storage = 'b2' AND object_key >= ?1 AND object_key < ?2",
      )
      .bind(lo, hi),
  ]);
  return {
    candidates: numberedPaths(file),
    taken: new Set(
      results.flatMap((r) => (r.results ?? []).map((x) => x.file)),
    ),
  };
};

/**
 * A name given out to an upload stays its own until it completes or this
 * long has passed (the presigned PUT is valid for 10 minutes).
 */
export const RESERVATION_MS = 30 * 60 * 1000;

/** The `setting` key holding an upload's claim on bucket path `file`. */
export const reservationKey = (file: string) => `camera_upload:${file}`;

/**
 * Claim `file` for an upload of camera `cameraId` with these bytes, in one
 * statement: refused while another upload's claim on it holds (so two
 * uploads at once never get the same name); the same bytes take it again
 * (a retry). Claims that expired are dropped first. With `unused` (an
 * upload's new name) it is also refused, in the same statement, while a
 * picture or a photo's file has the path (a パスで追加 since the name was
 * looked up).
 */
export const reservePictureName = async (
  db: D1Database,
  file: string,
  cameraId: number,
  sha256: string,
  now: Date,
  unused = false,
): Promise<boolean> => {
  const until = new Date(now.getTime() + RESERVATION_MS).toISOString();
  const [, claimed] = await db.batch<{ key: string }>([
    db
      .prepare(
        `DELETE FROM setting WHERE key >= 'camera_upload:' AND key < 'camera_upload;'
           AND json_extract(value, '$.until') < ?`,
      )
      .bind(now.toISOString()),
    db
      .prepare(
        `INSERT INTO setting (key, value)
           SELECT ?1, json_object('until', ?2, 'camera', ?3, 'sha256', ?4)
           WHERE ?6 = 0 OR (
             NOT EXISTS (SELECT 1 FROM camera_image WHERE file = ?5)
             AND NOT EXISTS (SELECT 1 FROM media_file
                             WHERE storage = 'b2' AND object_key = ?5))
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE json_extract(setting.value, '$.sha256') = ?4
           AND json_extract(setting.value, '$.camera') = ?3
         RETURNING key`,
      )
      .bind(
        reservationKey(file),
        until,
        cameraId,
        sha256,
        file,
        unused ? 1 : 0,
      ),
  ]);
  return (claimed.results ?? []).length > 0;
};

/**
 * Whether `file` is claimed by an upload of camera `cameraId` with these
 * bytes (the completion's proof that init gave it out, whatever the
 * camera's slug is now).
 */
export const holdsPictureName = async (
  db: D1Database,
  file: string,
  cameraId: number,
  sha256: string,
): Promise<boolean> =>
  (await db
    .prepare(
      `SELECT 1 AS found FROM setting WHERE key = ?1
         AND json_extract(value, '$.camera') = ?2
         AND json_extract(value, '$.sha256') = ?3`,
    )
    .bind(reservationKey(file), cameraId, sha256)
    .first()) !== null;

/** Add the uploaded picture and drop its claim (one batch). */
export const addUploadedPicture = async (
  db: D1Database,
  cameraId: number,
  file: string,
): Promise<number | null> => {
  const [inserted] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO camera_image (camera_id, file, caption, position)
         VALUES (?1, ?2, NULL,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM camera_image WHERE camera_id = ?1))
         ON CONFLICT (camera_id, file) DO NOTHING
         RETURNING id`,
      )
      .bind(cameraId, file),
    db.prepare("DELETE FROM setting WHERE key = ?").bind(reservationKey(file)),
    contentVersionStatement(db),
  ]);
  return (inserted.results ?? [])[0]?.id ?? null;
};

/**
 * One picture of the camera, with whether its object is shared; `file` is
 * null for a photo (0019), whose objects are the photo's.
 */
export const getCameraImage = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
): Promise<{ file: string | null; shared: boolean } | null> => {
  const row = await db
    .prepare(
      `SELECT i.file, (EXISTS (SELECT 1 FROM media_file f
                WHERE f.storage = 'b2' AND f.object_key = i.file)
              OR EXISTS (SELECT 1 FROM camera_image o
                WHERE o.file = i.file AND o.id <> i.id)) AS shared
       FROM camera_image i WHERE i.id = ? AND i.camera_id = ?`,
    )
    .bind(imageId, cameraId)
    .first<{ file: string | null; shared: number }>();
  return row ? { file: row.file, shared: row.shared !== 0 } : null;
};

/** Drop the claim on `file` (a 削除 that did not go through). */
export const releasePictureName = async (
  db: D1Database,
  file: string,
): Promise<void> => {
  await db
    .prepare("DELETE FROM setting WHERE key = ?")
    .bind(reservationKey(file))
    .run();
};

/**
 * How long a deleted file's path stays held after 削除: longer than the
 * toast's 元に戻す of an earlier 外す of the same file (on another camera)
 * lasts, so that undo cannot bring back a picture of a deleted object.
 */
export const DELETED_HOLD_MS = 2 * 60 * 1000;

/**
 * Delete the picture's row with the content version, in one batch; the
 * 削除's claim on its file stays a little longer (DELETED_HOLD_MS).
 */
export const deleteCameraImageRow = async (
  db: D1Database,
  cameraId: number,
  imageId: number,
  file: string,
  now: Date,
): Promise<boolean> => {
  const until = new Date(now.getTime() + DELETED_HOLD_MS).toISOString();
  const [res] = await db.batch([
    db
      .prepare("DELETE FROM camera_image WHERE id = ? AND camera_id = ?")
      .bind(imageId, cameraId),
    db
      .prepare(
        `INSERT INTO setting (key, value)
           VALUES (?1, json_object('until', ?2, 'camera', 0, 'sha256', 'deleted'))
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .bind(reservationKey(file), until),
    contentVersionStatement(db),
  ]);
  return (res.meta.changes ?? 0) > 0;
};
