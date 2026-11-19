// The files of a photo (migration 0013, media_file): which one an image of
// the photo is resized from, and removing their objects for good. Covered
// by media-file.spec.ts on the real schema.

import { POSTER_OF_SHOWN } from "@shared/resized/claim";

/** media_file.storage. */
export type FileStorage = "b2" | "r2";

/** A stored object of a photo. */
export type FileObject = { storage: FileStorage; key: string };

/**
 * Joins `src`, the file an image of the photo `m` is resized from: the
 * file the photo shows (media.active_file_id, NULL = the original), or
 * that file's newest ready display copy, or a video's poster (a video
 * without one is its own file, which /thumb refuses). The same rule as the API
 * Worker's (workers/api/src/query.ts SOURCE_JOINS), in a few index steps:
 * the original by idx_media_file_media, the shown file by its id, the
 * copy by idx_media_file_source.
 */
export const IMAGE_SOURCE_JOINS = `
  JOIN media_file shown ON shown.id = COALESCE(m.active_file_id,
    (SELECT o.id FROM media_file o
     WHERE o.media_id = m.id AND o.role = 'original'))
    AND shown.media_id = m.id
  JOIN media_file src ON src.id = COALESCE(
    (SELECT dc.id FROM media_file dc
     WHERE dc.source_file_id = shown.id AND dc.role = 'display'
       AND dc.status = 'ready' AND dc.media_id = m.id
     ORDER BY dc.id DESC LIMIT 1),
    ${POSTER_OF_SHOWN},
    shown.id)`;

/**
 * The file an image of the photo whose original is `?1` (media.file) is
 * resized from (IMAGE_SOURCE_JOINS; the photo by media.file's UNIQUE
 * index), and the photo's public id (the key of its resized copies).
 */
export const IMAGE_SOURCE_SQL = `SELECT src.storage, src.object_key AS key,
    m.public_id
  FROM media m ${IMAGE_SOURCE_JOINS}
  WHERE m.file = ?1`;

/** The object an image is resized from, and its photo's public id. */
export type ImageSource = FileObject & { publicId: string | null };

/**
 * The object to resize for a thumbnail of `file`: a photo's original key
 * (what the admin's pages link) gives the file the photo shows or its
 * display copy; anything else (a camera picture) is itself, with no
 * public id.
 */
export const imageSource = async (
  db: D1Database,
  file: string,
): Promise<ImageSource> => {
  const row = await db
    .prepare(IMAGE_SOURCE_SQL)
    .bind(file)
    .first<{ storage: string; key: string; public_id: string }>();
  return row
    ? {
        storage: row.storage === "r2" ? "r2" : "b2",
        key: row.key,
        publicId: row.public_id,
      }
    : { storage: "b2", key: file, publicId: null };
};

/**
 * Every stored object of the photos `ids` (each of their files, any role
 * or status), with whether it is also a camera picture (that object stays:
 * the camera page still shows it).
 */
export const PHOTO_OBJECTS_SQL = `SELECT f.media_id, f.storage, f.object_key AS key,
    EXISTS (SELECT 1 FROM camera_image c
            WHERE f.storage = 'b2' AND c.file = f.object_key) AS shared
  FROM media_file f
  WHERE f.media_id IN (SELECT value FROM json_each(?1))
  ORDER BY f.media_id, f.id`;

export type PhotoObject = FileObject & { mediaId: number; shared: boolean };

export const photoObjects = async (
  db: D1Database,
  ids: readonly number[],
): Promise<PhotoObject[]> => {
  if (ids.length === 0) return [];
  const rows =
    (
      await db.prepare(PHOTO_OBJECTS_SQL).bind(JSON.stringify(ids)).all<{
        media_id: number;
        storage: string;
        key: string;
        shared: number;
      }>()
    ).results ?? [];
  return rows.map((r) => ({
    mediaId: r.media_id,
    storage: r.storage === "r2" ? "r2" : "b2",
    key: r.key,
    shared: r.shared !== 0,
  }));
};

/** An object in a storage the admin cannot delete from yet. */
export class UnsupportedStorageError extends Error {
  constructor(storage: string) {
    super(`${storage} のファイルはまだ削除できません`);
    this.name = "UnsupportedStorageError";
  }
}
