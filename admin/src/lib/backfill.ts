// Reading the metadata in the originals (covered by backfill.spec.ts on
// the real schema), for photos the uploader did not read (uploaded before
// it could) and again whenever the parser improves (PHOTO_META_PARSER_DATE).
// The admin cannot read the bucket, so the image Worker's AdminImage.bytes
// hands it the first (and for some PNGs the last) bytes of each original;
// photo-meta.ts reads them, and metadata-source.ts decides field by field
// what the reading may replace (never a value entered by hand).
//
// Admin pages call it on their own while open (MetadataReader), a batch
// at a time. media.metadata_read_at says where a photo stands:
//   NULL                      never read (or reset): waiting
//   <ISO time>                read; waiting again once older than the
//                             parser date
//   'reading:<ISO time>[!new]' claimed by a batch, so two tabs never read
//                             the same photo; taken again after
//                             CLAIM_STALE_MS (a request that died)
//   'failed:<ISO time>[!new]'  could not be read or written; tried again
//                             after FAILED_RETRY_MS
// '!new' carries "never read before" through a claim (applyReading's
// firstRead). Each request stays well under the Pages Functions
// subrequest limit (50; each photo takes one or two AdminImage calls).

import {
  deviceIdArgs,
  deviceOf,
  ensureDeviceStatement,
  linkDeviceSql,
} from "./device";
import { applyReading, type Reading, type SourcedRow } from "./metadata-source";
import {
  EMPTY_STORED,
  hasMeta,
  needsTail,
  normalizeExif,
  normalizeFileExif,
  PHOTO_META_PARSER_DATE,
  readFileTool,
  readPhotoMeta,
  type FileDates,
  type FileTool,
} from "./photo-meta";
import { displaySize, imageSize, type ImageSize } from "./image-size";
import { contentChanged } from "./last-good";
import { pickTakenAt } from "./taken-at";

const NO_TOOL: FileTool = { creatorTool: null, xmpSummary: null };
/**
 * types.ts LIVE_PHOTO with its columns kept off their indexes (unary +):
 * idx_media_status would match nearly every row, and the planner (no
 * statistics on D1) may prefer it to idx_media_metadata_read_at, which
 * finds the few rows waiting (backfill.spec.ts checks the plan).
 */
const LIVE = "+status = 'ready' AND +trashed_at IS NULL";

export { PHOTO_META_PARSER_DATE };

/** A claim older than this is taken to be abandoned. */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

/** A photo that could not be read is tried again after this. */
export const FAILED_RETRY_MS = 24 * 60 * 60 * 1000;

const CLAIM = "reading:";
const FAILED = "failed:";
const NEW = "!new";

/** Photos per request. */
export const BACKFILL_BATCH = 12;

/**
 * Bytes read from the start of an original: a JPEG's EXIF segment is at
 * most 64 KB, after the few bytes before it (JFIF, maybe XMP first).
 */
export const HEAD_BYTES = 128 * 1024;

/** Bytes read from the end of a PNG whose text chunks follow the image. */
export const TAIL_BYTES = 64 * 1024;

const NO_DATES: FileDates = {
  exifOriginal: null,
  xmp: null,
  exifDateTime: null,
};

export type ReadBytes = (
  file: string,
  range: { offset: number; length: number } | { suffix: number },
) => Promise<{ bytes: Uint8Array; size: number } | null>;

export type BackfillResult = {
  /** Files looked at in this batch (originals, then retouched versions). */
  read: number;
  /** Of those, the ones something was found in. */
  found: number;
  /** Ones that could not be read or written now (tried again later). */
  failed: number;
  /** Photos whose (original's) reading was written: the public API may change. */
  photos: number;
  /** Whether there may be more to read (a full batch was claimed). */
  more: boolean;
};

const iso = (ms: number) => new Date(ms).toISOString();

/** A stored JSON column, or null when it is empty or unreadable. */
const parseJson = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * metadata_read_at for a photo read now: never earlier than the parser
 * date, so a parser date set slightly ahead (before the code is deployed)
 * does not make the new code read the same photos again.
 */
export const readStamp = (nowMs: number) => {
  const now = iso(nowMs);
  return now > PHOTO_META_PARSER_DATE ? now : PHOTO_META_PARSER_DATE;
};

/**
 * A photo to read, in SQL (?1 the parser date, ?2 the cut-off for claims,
 * ?3 the cut-off for failures).
 */
// Ranges only, so idx_media_metadata_read_at (0008) answers each term:
// read times start with a digit, below 'failed:' and 'reading:', and a
// marker compares by its fixed-width time.
const UNREAD = `(metadata_read_at IS NULL
  OR metadata_read_at < ?1
  OR (metadata_read_at >= '${CLAIM}' AND metadata_read_at < ?2)
  OR (metadata_read_at >= '${FAILED}' AND metadata_read_at < ?3))`;

/** The photos waiting to be read, in SQL (bind unreadArgs). */
export const WAITING_SQL = `${UNREAD} AND ${LIVE}`;

export const unreadArgs = (nowMs: number) => [
  PHOTO_META_PARSER_DATE,
  CLAIM + iso(nowMs - CLAIM_STALE_MS),
  FAILED + iso(nowMs - FAILED_RETRY_MS),
];

/**
 * How many photos are waiting to be read (tests and one-off checks only:
 * the pages never count, to spare D1's daily row reads).
 */
export const countUnread = async (
  db: D1Database,
  nowMs: number = Date.now(),
): Promise<number> => {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM media WHERE ${WAITING_SQL}`)
    .bind(...unreadArgs(nowMs))
    .first<{ c: number }>();
  return row?.c ?? 0;
};

type ClaimedRow = SourcedRow & {
  id: number;
  file: string;
  platform: string;
  /** The claim as written (the guard of every later write). */
  metadata_read_at: string;
  updated_at: string;
};

/**
 * Read the next batch of photos waiting to be read (in no particular
 * order: once claimed, read or failed, a photo no longer waits, so
 * calling this until `more` is false goes through them all). A photo
 * whose original is missing is marked read (there is nothing more to read
 * than its name); one that cannot be read or written is marked failed
 * and tried again after FAILED_RETRY_MS.
 */
export const backfillBatch = async (
  db: D1Database,
  read: ReadBytes,
  limit: number = BACKFILL_BATCH,
  nowMs: number = Date.now(),
): Promise<BackfillResult> => {
  // Claim atomically: a second tab's claim finds these rows taken.
  const claimed = (
    ((
      await db
        .prepare(
          `UPDATE media SET metadata_read_at = ?4 ||
             CASE WHEN metadata_read_at IS NULL
                    OR metadata_read_at LIKE '%${NEW}' THEN '${NEW}' ELSE '' END
           WHERE id IN (SELECT id FROM media
                        WHERE ${WAITING_SQL} LIMIT ?5)
             AND ${UNREAD}
           RETURNING id, file, platform, timestamp, exif, latitude, longitude,
                     location_source, world_id, world_name, world_author_id,
                     metadata_source, file_exif, digitized_at,
                     metadata_read_at, updated_at`,
        )
        .bind(...unreadArgs(nowMs), CLAIM + iso(nowMs), limit)
        .all<ClaimedRow>()
    ).results ?? []) as ClaimedRow[]
  ).sort((a, b) => a.id - b.id);

  // Photos on a virtual platform never get a new camera row (device.ts).
  const virtualPlatforms = new Set(
    claimed.length === 0
      ? []
      : (
          (
            await db
              .prepare("SELECT key FROM platform WHERE kind = 'virtual'")
              .all<{ key: string }>()
          ).results ?? []
        ).map((r) => r.key),
  );

  const errors: string[] = [];
  const results = await Promise.all(
    claimed.map(async (row) => {
      try {
        const head = await read(row.file, { offset: 0, length: HEAD_BYTES });
        let tail: Uint8Array | undefined;
        if (head && head.size > head.bytes.length && needsTail(head.bytes)) {
          tail = (await read(row.file, { suffix: TAIL_BYTES }))?.bytes;
        }
        let reading: Reading;
        let tool: FileTool = NO_TOOL;
        let size: ImageSize | null = null;
        if (!head) {
          // Not in the bucket: nothing to read, but the name may say.
          reading = {
            ...EMPTY_STORED,
            takenAt: pickTakenAt(NO_DATES, row.file),
          };
        } else {
          const {
            takenAt: _,
            dates,
            ...meta
          } = await readPhotoMeta(head.bytes, tail);
          reading = { ...meta, takenAt: pickTakenAt(dates, row.file) };
          tool = await readFileTool(head.bytes, tail, meta.fileExif?.software);
          // The pixel size as displayed (0016), from the same header.
          const header = imageSize(head.bytes);
          size = header && displaySize(header, meta.fileExif?.orientation);
        }
        return { row, reading, tool, size };
      } catch (err) {
        console.error(`backfill ${row.file} failed:`, err);
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      }
    }),
  );
  const readOk = results.filter((r) => r !== null);

  // Only while the claim is ours and the row was not edited meanwhile
  // (every edit bumps updated_at; the claim does not).
  const GUARD = "id = ?1 AND metadata_read_at = ?2 AND updated_at IS ?3";
  // The photo's write, after the statement creating the camera row its
  // file names when there is none yet (device.ts): the write links it.
  // Before it, under the same guard, what wrote the original goes to its
  // media_file row (0013; the rest of that row follows media's columns).
  const write = ({ row, reading, tool, size }: (typeof readOk)[number]) => {
    const fileRow = db
      .prepare(
        `UPDATE media_file SET creator_tool = ?4, xmp_summary = ?5
         WHERE media_id = ?1 AND role = 'original'
           AND EXISTS (SELECT 1 FROM media WHERE ${GUARD})`,
      )
      .bind(
        row.id,
        row.metadata_read_at,
        row.updated_at,
        tool.creatorTool,
        tool.xmpSummary ? JSON.stringify(tool.xmpSummary) : null,
      );
    const next = applyReading(row, reading, row.metadata_read_at.endsWith(NEW));
    // The camera from the shooting EXIF as it will be stored: one
    // corrected by hand names the camera, not the file's.
    const device = deviceOf(
      { exif: normalizeExif(parseJson(next.exif)), fileExif: reading.fileExif },
      row.platform,
      virtualPlatforms,
    );
    const update = db
      .prepare(
        `UPDATE media SET timestamp = ?4, exif = ?5, latitude = ?6,
           longitude = ?7, location_source = ?8, world_id = ?9,
           world_name = ?10, world_author_id = ?11, metadata_source = ?12,
           metadata_read_at = ?13, file_exif = ?14, digitized_at = ?15,
           width = COALESCE(?21, width), height = COALESCE(?22, height),
           ${linkDeviceSql("?16", "?17", "?18", "?19", "?20")}
         WHERE ${GUARD}`,
      )
      .bind(
        row.id,
        row.metadata_read_at,
        row.updated_at,
        next.timestamp,
        next.exif,
        next.latitude,
        next.longitude,
        next.location_source,
        next.world_id,
        next.world_name,
        next.world_author_id,
        next.metadata_source,
        readStamp(nowMs),
        next.file_exif,
        next.digitized_at,
        device?.role ?? null,
        ...deviceIdArgs(device),
        size?.width ?? null,
        size?.height ?? null,
      );
    return device?.create
      ? [ensureDeviceStatement(db, device, row.id), fileRow, update]
      : [fileRow, update];
  };
  const written = new Set<number>();
  if (readOk.length > 0) {
    try {
      const groups = readOk.map(write);
      const out = (await db.batch(groups.flat())) as D1Result[];
      // Each photo's write is the last statement of its group.
      let at = -1;
      groups.forEach((g, i) => {
        at += g.length;
        if ((out[at].meta?.changes ?? 0) > 0) written.add(readOk[i].row.id);
      });
    } catch (err) {
      // One row the schema refuses would roll back the whole batch, every
      // run: write them one by one.
      console.error("backfill batch failed, retrying one by one:", err);
      for (const r of readOk) {
        try {
          const out = (await db.batch(write(r))) as D1Result[];
          const res = out[out.length - 1];
          if ((res.meta?.changes ?? 0) > 0) written.add(r.row.id);
        } catch (e) {
          console.error(`backfill row ${r.row.id} refused:`, e);
        }
      }
    }
  }

  // The rest failed (or were edited meanwhile: tried again later too).
  const failed = claimed.filter((r) => !written.has(r.id));
  // Several photos and not one could be read: most likely the Worker or
  // the login, not the photos. Their claims expire in CLAIM_STALE_MS
  // rather than putting real photos off for a day. (A lone photo that
  // fails is marked, or it would come back every ten minutes.)
  const outage = readOk.length === 0 && claimed.length > 1;
  if (failed.length > 0 && !outage) {
    await db.batch(
      failed.map((row) =>
        db
          .prepare(`UPDATE media SET metadata_read_at = ?4 WHERE ${GUARD}`)
          .bind(
            row.id,
            row.metadata_read_at,
            row.updated_at,
            FAILED +
              iso(nowMs) +
              (row.metadata_read_at.endsWith(NEW) ? NEW : ""),
          ),
      ),
    );
  }
  // Nothing could be read at all: the Worker or the login is the problem,
  // not the photos. Say so (the reader stops until the next page view).
  if (claimed.length > 0 && readOk.length === 0) {
    throw new Error(`no original could be read: ${errors[0]}`);
  }
  const found = readOk.filter(
    ({ row, reading }) =>
      written.has(row.id) && (hasMeta(reading) || reading.takenAt !== null),
  ).length;
  // The rest of the batch for retouched versions.
  let edits = { read: 0, found: 0, failed: 0 };
  if (claimed.length < limit) {
    try {
      edits = await readEditFiles(db, read, limit - claimed.length, nowMs);
    } catch (err) {
      // With photos read in this batch, their writes stand (and get
      // published); the edits' claims expire.
      if (claimed.length === 0) throw err;
      console.error("backfill of retouched versions failed:", err);
    }
  }
  return {
    read: claimed.length + edits.read,
    found: found + edits.found,
    failed: failed.length + edits.failed,
    photos: written.size,
    more: claimed.length + edits.read === limit,
  };
};

/**
 * The edits waiting to be read (?1–?3 as UNREAD), by idx_media_file_edit_read
 * (storage kept off the UNIQUE (storage, object_key) index with a unary +,
 * as LIVE above; only B2 can be read for now). SQLite walks that partial
 * index, whose entries are the ready edits only: as many rows as there
 * are retouched versions, never the originals.
 */
export const WAITING_EDITS_SQL = `role = 'edit' AND status = 'ready'
  AND +storage = 'b2' AND ${UNREAD}`;

type ClaimedFile = {
  id: number;
  object_key: string;
  metadata_read_at: string;
};

/**
 * Read up to `limit` retouched versions (media_file role 'edit', 0013)
 * waiting to be read, like the originals: claimed the same way on their
 * own metadata_read_at. What is found fills only that file's row
 * (file_exif, creator_tool, xmp_summary): an edit's EXIF and XMP describe
 * the program that wrote it as much as the shot, so the photo's shooting
 * information (media.exif, timestamp, camera, ...) never comes from it.
 * Nothing public changes.
 */
export const readEditFiles = async (
  db: D1Database,
  read: ReadBytes,
  limit: number,
  nowMs: number = Date.now(),
): Promise<{ read: number; found: number; failed: number }> => {
  const claimed =
    (
      await db
        .prepare(
          `UPDATE media_file SET metadata_read_at = ?4 ||
             CASE WHEN metadata_read_at IS NULL
                    OR metadata_read_at LIKE '%${NEW}' THEN '${NEW}' ELSE '' END
           WHERE id IN (SELECT id FROM media_file
                        WHERE ${WAITING_EDITS_SQL} LIMIT ?5)
             AND ${UNREAD}
           RETURNING id, object_key, metadata_read_at`,
        )
        .bind(...unreadArgs(nowMs), CLAIM + iso(nowMs), limit)
        .all<ClaimedFile>()
    ).results ?? [];
  if (claimed.length === 0) return { read: 0, found: 0, failed: 0 };

  const errors: string[] = [];
  const results = await Promise.all(
    claimed.map(async (row) => {
      try {
        const head = await read(row.object_key, {
          offset: 0,
          length: HEAD_BYTES,
        });
        if (!head) return { row, fileExif: null, tool: NO_TOOL };
        let tail: Uint8Array | undefined;
        if (head.size > head.bytes.length && needsTail(head.bytes)) {
          tail = (await read(row.object_key, { suffix: TAIL_BYTES }))?.bytes;
        }
        const meta = await readPhotoMeta(head.bytes, tail);
        const fileExif = normalizeFileExif(meta.fileExif);
        const tool = await readFileTool(head.bytes, tail, fileExif?.software);
        return { row, fileExif, tool };
      } catch (err) {
        console.error(`backfill ${row.object_key} failed:`, err);
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      }
    }),
  );
  const readOk = results.filter((r) => r !== null);
  const GUARD = "id = ?1 AND metadata_read_at = ?2";
  const written = new Set<number>();
  for (const r of readOk) {
    try {
      const res = await db
        .prepare(
          `UPDATE media_file SET file_exif = ?3, creator_tool = ?4,
             xmp_summary = ?5, metadata_read_at = ?6 WHERE ${GUARD}`,
        )
        .bind(
          r.row.id,
          r.row.metadata_read_at,
          r.fileExif ? JSON.stringify(r.fileExif) : null,
          r.tool.creatorTool,
          r.tool.xmpSummary ? JSON.stringify(r.tool.xmpSummary) : null,
          readStamp(nowMs),
        )
        .run();
      if ((res.meta.changes ?? 0) > 0) written.add(r.row.id);
    } catch (err) {
      console.error(`backfill file ${r.row.id} refused:`, err);
    }
  }
  const failed = claimed.filter((r) => !written.has(r.id));
  // As for originals: when none of several could be read, the claims just
  // expire.
  const outage = readOk.length === 0 && claimed.length > 1;
  if (failed.length > 0 && !outage) {
    await db.batch(
      failed.map((row) =>
        db
          .prepare(`UPDATE media_file SET metadata_read_at = ?3 WHERE ${GUARD}`)
          .bind(
            row.id,
            row.metadata_read_at,
            FAILED +
              iso(nowMs) +
              (row.metadata_read_at.endsWith(NEW) ? NEW : ""),
          ),
      ),
    );
  }
  if (readOk.length === 0) {
    throw new Error(`no retouched version could be read: ${errors[0]}`);
  }
  return {
    read: claimed.length,
    found: readOk.filter(
      (r) =>
        written.has(r.row.id) &&
        (r.fileExif !== null ||
          r.tool.creatorTool !== null ||
          r.tool.xmpSummary !== null),
    ).length,
    failed: failed.length,
  };
};

/**
 * A batch, then a new content version (last-good.ts) when it wrote any
 * photo: its timestamp, metadata, size, camera or スキャン機材 may now read
 * differently in the public API. What POST /api/metadata/backfill runs.
 */
export const backfillAndPublish = async (
  db: D1Database,
  read: ReadBytes,
  limit: number = BACKFILL_BATCH,
  nowMs: number = Date.now(),
): Promise<BackfillResult> => {
  const result = await backfillBatch(db, read, limit, nowMs);
  // A retouched version's reading is admin only: no new version for it.
  if (result.photos > 0) await contentChanged(db);
  return result;
};
