// Reading the metadata of photos uploaded before the uploader did it
// (covered by backfill.spec.ts on the real schema). The admin cannot read
// the bucket, so the image Worker's AdminImage.bytes hands it the first
// (and for some PNGs the last) bytes of each original; photo-meta.ts reads
// them, and only the columns still empty are filled.
//
// Idempotent: a photo is read once (media.metadata_read_at), and a run
// goes through the photos by id in small batches so that each request
// stays well under the Pages Functions subrequest limit (50; each photo
// takes one or two AdminImage calls).

import { metaColumns } from "./db-upload";
import { LIVE_PHOTO } from "./types";
import { EMPTY_STORED, hasMeta, needsTail, readPhotoMeta } from "./photo-meta";

/** Photos per request. */
export const BACKFILL_BATCH = 12;

/**
 * Bytes read from the start of an original: a JPEG's EXIF segment is at
 * most 64 KB, after the few bytes before it (JFIF, maybe XMP first).
 */
export const HEAD_BYTES = 128 * 1024;

/** Bytes read from the end of a PNG whose text chunks follow the image. */
export const TAIL_BYTES = 64 * 1024;

export type ReadBytes = (
  file: string,
  range: { offset: number; length: number } | { suffix: number },
) => Promise<{ bytes: Uint8Array; size: number } | null>;

export type BackfillResult = {
  /** Photos looked at in this batch. */
  read: number;
  /** Of those, the ones something was found in. */
  found: number;
  /** Ones that could not be read now (left for a later run). */
  failed: number;
  /** Pass as `after` for the next batch; null when this was the last. */
  next: number | null;
};

/** How many ready photos have not been read yet. */
export const countUnread = async (db: D1Database): Promise<number> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM media WHERE ${LIVE_PHOTO} AND metadata_read_at IS NULL`,
    )
    .first<{ c: number }>();
  return row?.c ?? 0;
};

const FILL_SQL = `UPDATE media SET
  exif = COALESCE(exif, ?2),
  latitude = CASE WHEN latitude IS NULL THEN ?3 ELSE latitude END,
  longitude = CASE WHEN latitude IS NULL THEN ?4 ELSE longitude END,
  location_source = CASE WHEN latitude IS NULL AND ?3 IS NOT NULL
                         THEN 'exif' ELSE location_source END,
  world_id = CASE WHEN world_id IS NULL AND world_name IS NULL
                  THEN ?5 ELSE world_id END,
  world_name = CASE WHEN world_id IS NULL AND world_name IS NULL
                    THEN ?6 ELSE world_name END,
  world_author_id = CASE WHEN world_id IS NULL AND world_name IS NULL
                         THEN ?7 ELSE world_author_id END,
  timestamp = COALESCE(timestamp, ?8),
  metadata_read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?1 AND metadata_read_at IS NULL`;

/**
 * Read the next batch of unread photos after id `after`. A photo whose
 * original is missing is marked read (there is nothing to read); one that
 * fails (the Worker or the bucket) is skipped and stays unread.
 */
export const backfillBatch = async (
  db: D1Database,
  read: ReadBytes,
  after: number,
  limit: number = BACKFILL_BATCH,
): Promise<BackfillResult> => {
  const rows =
    (
      await db
        .prepare(
          `SELECT id, file FROM media
           WHERE ${LIVE_PHOTO} AND metadata_read_at IS NULL AND id > ?1
           ORDER BY id LIMIT ?2`,
        )
        .bind(after, limit)
        .all<{ id: number; file: string }>()
    ).results ?? [];
  const errors: string[] = [];
  const results = await Promise.all(
    rows.map(async ({ id, file }) => {
      try {
        const head = await read(file, { offset: 0, length: HEAD_BYTES });
        let tail: Uint8Array | undefined;
        if (head && head.size > head.bytes.length && needsTail(head.bytes)) {
          tail = (await read(file, { suffix: TAIL_BYTES }))?.bytes;
        }
        const { takenAt, ...meta } = head
          ? await readPhotoMeta(head.bytes, tail)
          : { takenAt: null, ...EMPTY_STORED };
        return { id, meta, takenAt };
      } catch (err) {
        console.error(`backfill ${file} failed:`, err);
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      }
    }),
  );
  let done = results.filter((r) => r !== null);
  // Nothing could be read at all: the Worker or the login is the problem,
  // not the photos. Stop here with the reason rather than going through
  // every photo the same way.
  if (rows.length > 0 && done.length === 0) {
    throw new Error(`no original could be read: ${errors[0]}`);
  }
  const fill = ({ id, meta, takenAt }: (typeof done)[number]) => {
    const c = metaColumns(meta);
    return db
      .prepare(FILL_SQL)
      .bind(
        id,
        c.exif,
        c.latitude,
        c.longitude,
        c.world_id,
        c.world_name,
        c.world_author_id,
        takenAt,
      );
  };
  if (done.length > 0) {
    try {
      await db.batch(done.map(fill));
    } catch (err) {
      // One row the schema refuses would roll back the whole batch, every
      // run: write them one by one, and leave the refused ones unread.
      console.error("backfill batch failed, retrying one by one:", err);
      const ok: typeof done = [];
      for (const r of done) {
        try {
          await fill(r).run();
          ok.push(r);
        } catch (e) {
          console.error(`backfill row ${r.id} refused:`, e);
        }
      }
      done = ok;
    }
  }
  const found = done.filter(({ meta }) => hasMeta(meta)).length;
  const failed = rows.length - done.length;
  return {
    read: rows.length,
    found,
    failed,
    next: rows.length < limit ? null : rows[rows.length - 1].id,
  };
};
