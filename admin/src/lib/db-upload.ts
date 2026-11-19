// D1 side of uploads (see 0004_upload.sql): reserve a row before the PUT,
// mark it ready after, and list / drop the ones that never completed.
// Covered by db-upload.spec.ts on the real schema.

import {
  deviceIdArgs,
  deviceIdSql,
  deviceOf,
  ensureDeviceStatement,
} from "./device";
import { serializeSources } from "./metadata-source";
import {
  EMPTY_STORED,
  PHOTO_META_PARSER_DATE,
  type StoredMeta,
} from "./photo-meta";
import { formatUploadSize, groupDigits, type UploadInit } from "./upload";
import type { MediaPlatform } from "./types";

/** media columns (0005) for metadata read from the file itself. */
export const metaColumns = (meta: StoredMeta) => ({
  exif: meta.exif ? JSON.stringify(meta.exif) : null,
  latitude: meta.location?.latitude ?? null,
  longitude: meta.location?.longitude ?? null,
  location_source: meta.location ? ("exif" as const) : null,
  world_id: meta.world?.id ?? null,
  world_name: meta.world?.name ?? null,
  world_author_id: meta.world?.authorId ?? null,
  file_exif: meta.fileExif ? JSON.stringify(meta.fileExif) : null,
  digitized_at: meta.digitizedAt,
});

export type InitOutcome =
  /**
   * Upload to the row `id` at `file` (new, or an earlier attempt being
   * resumed). `file` differs from the requested path when that was taken
   * by another photo ("IMG_0001-1.jpg"), or when the same photo's earlier
   * attempt went elsewhere.
   */
  | { kind: "upload"; id: number; file: string; resumed: boolean }
  /** This photo (same SHA-256) is already uploaded, at `file`. */
  | { kind: "exists"; id: number; file: string }
  /** Cannot upload here; `message` says why. */
  | { kind: "conflict"; message: string; retry: boolean };

type Existing = {
  id: number;
  file: string;
  path: string;
  status: string;
  sha256: string | null;
  trashed_at: string | null;
};

const EXISTING_COLUMNS = "id, file, path, status, sha256, trashed_at";

/**
 * The bounds [lo, hi) of the numbered names of `file` (numberedPaths
 * after the first): every path that starts with "<stem>-" and a digit,
 * "/a/IMG-1.jpg" … "/a/IMG-50.jpg". Other paths in it ("IMG-2x.png", a
 * folder "IMG-2026/") never match a candidate.
 */
export const numberedRange = (file: string): [string, string] => {
  const { stem } = numberedStem(file);
  return [`${stem}-0`, `${stem}-:`];
};

/**
 * What initUpload reads (SQL + bind args, run as one D1 batch): the row
 * with this SHA-256 (idx_media_sha256), then the rows whose file (the
 * UNIQUE index on file) and the photos not in the trash whose path
 * (idx_media_path_live) may be one of `file`'s numberedPaths: the name
 * itself or one in numberedRange. Not `IN (SELECT value FROM
 * json_each(…))` of the 51 names: D1 counts each element of the list and
 * each index probe, about 200 rows per call however empty the folder is,
 * while a range reads only the rows in it.
 */
export const initLookups = (
  sha256: string,
  file: string,
): { sql: string; args: string[] }[] => {
  const [lo, hi] = numberedRange(file);
  const select = `SELECT ${EXISTING_COLUMNS} FROM media WHERE`;
  return [
    { sql: `${select} sha256 = ?`, args: [sha256] },
    {
      sql: `${select} file = ?1 OR (file >= ?2 AND file < ?3)`,
      args: [file, lo, hi],
    },
    // Two statements: SQLite does not split an OR over a partial index.
    { sql: `${select} trashed_at IS NULL AND path = ?`, args: [file] },
    {
      sql: `${select} trashed_at IS NULL AND path >= ?1 AND path < ?2`,
      args: [lo, hi],
    },
  ];
};

const isUniqueError = (err: unknown) =>
  err instanceof Error && /UNIQUE constraint failed: media\./.test(err.message);

/**
 * Reserve a path for an upload of `init.file`. A new row is private,
 * `uploading`, with the given public id and platform; when another photo
 * already has that path, the first free numbered name is used instead
 * (numberedPaths). An `uploading` row with the same hash is resumed (a
 * retry, or picking the same file again after a failure).
 */
export const initUpload = async (
  db: D1Database,
  init: UploadInit,
  row: { publicId: string; platform: MediaPlatform },
): Promise<InitOutcome> => {
  const candidates = numberedPaths(init.file);
  const [bySha, ...byName] = await db.batch<Existing>(
    initLookups(init.sha256, init.file).map((q) =>
      db.prepare(q.sql).bind(...q.args),
    ),
  );
  const same = (bySha.results ?? [])[0];
  if (same) {
    if (same.trashed_at !== null) {
      return {
        kind: "conflict",
        message: `同じ写真がゴミ箱にあります (${same.path})`,
        retry: false,
      };
    }
    if (same.status === "ready") {
      return { kind: "exists", id: same.id, file: same.path };
    }
    return { kind: "upload", id: same.id, file: same.file, resumed: true };
  }
  // A name is taken by another file in the bucket (any row: keys never
  // change) or by a photo shown there (path, not trashed: moved photos).
  // The lookups may return other names too; only the candidates count.
  const taken = new Set(
    byName
      .flatMap((r) => r.results ?? [])
      .flatMap((r) => (r.trashed_at === null ? [r.file, r.path] : [r.file])),
  );
  const file = candidates.find((c) => !taken.has(c));
  if (!file) {
    return {
      kind: "conflict",
      message: `${init.file} と同じ名前が多すぎます`,
      retry: false,
    };
  }
  const meta = metaColumns(init.meta ?? EMPTY_STORED);
  // Where each value came from (metadata-source.ts); a timestamp without a
  // source is left unknown, the weakest.
  const sources = serializeSources({
    ...(init.timestamp !== null && init.timestampSource
      ? { taken_at: init.timestampSource }
      : {}),
    ...(meta.exif ? { exif: "file" as const } : {}),
    ...(meta.world_id || meta.world_name ? { world: "file" as const } : {}),
  });
  // The camera (or scanner) the file names: its row, created first when
  // there is none (device.ts), in the same batch.
  const device = deviceOf(init.meta ?? {}, row.platform);
  const deviceId = deviceIdSql("?20", "?21", "?22", "?23");
  try {
    const insert = db
      .prepare(
        `INSERT INTO media (public_id, file, path, platform, timestamp, tags, visibility, status, size, sha256,
           exif, latitude, longitude, location_source, world_id, world_name, world_author_id, metadata_read_at,
           metadata_source, file_exif, digitized_at, camera_id, digitized_with)
         VALUES (?1, ?2, ?2, ?3, ?4, '[]', 'private', 'uploading', ?5, ?6,
           ?7, ?8, ?9, ?10, ?11, ?12, ?13,
           CASE WHEN ?14 THEN MAX(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?16) END, ?15,
           ?17, ?18,
           CASE WHEN ?19 = 'camera' THEN ${deviceId} END,
           CASE WHEN ?19 = 'digitizer' THEN ${deviceId} END) RETURNING id`,
      )
      .bind(
        row.publicId,
        file,
        row.platform,
        init.timestamp,
        init.size,
        init.sha256,
        meta.exif,
        meta.latitude,
        meta.longitude,
        meta.location_source,
        meta.world_id,
        meta.world_name,
        meta.world_author_id,
        // Read in the browser: the backfill can skip it.
        // Read in the browser with this parser: nothing left to read. (A tab
        // still running an older one leaves it to the reader.)
        init.meta && init.parserDate === PHOTO_META_PARSER_DATE ? 1 : 0,
        sources,
        // Read with today's parser (backfill.ts readStamp).
        PHOTO_META_PARSER_DATE,
        meta.file_exif,
        meta.digitized_at,
        device?.role ?? null,
        ...deviceIdArgs(device),
      );
    const out = await db.batch<{ id: number }>(
      device?.create ? [ensureDeviceStatement(db, device), insert] : [insert],
    );
    const inserted = out[out.length - 1].results?.[0];
    if (!inserted) throw new Error("INSERT INTO media returned no row");
    return { kind: "upload", id: inserted.id, file, resumed: false };
  } catch (err) {
    // Lost a race with another upload of the same path or photo; the
    // browser retries (and then resumes or takes the next name).
    if (isUniqueError(err)) {
      return {
        kind: "conflict",
        message: `${file} は別のアップロードと重なりました`,
        retry: true,
      };
    }
    throw err;
  }
};

/** "/a/IMG.jpg" → stem "/a/IMG", ext ".jpg" (ext "" without a dot). */
const numberedStem = (file: string): { stem: string; ext: string } => {
  const slash = file.lastIndexOf("/");
  const dot = file.lastIndexOf(".");
  return dot > slash
    ? { stem: file.slice(0, dot), ext: file.slice(dot) }
    : { stem: file, ext: "" };
};

/** How many numbered names are tried after the requested one. */
export const MAX_NAME_NUMBER = 50;

/**
 * `file` and its numbered variants, in the order they are tried:
 * "/a/IMG.jpg", "/a/IMG-1.jpg", ..., "/a/IMG-50.jpg".
 */
export const numberedPaths = (file: string): string[] => {
  const { stem, ext } = numberedStem(file);
  return [
    file,
    ...Array.from(
      { length: MAX_NAME_NUMBER },
      (_, i) => `${stem}-${i + 1}${ext}`,
    ),
  ];
};

/**
 * "B2 は 12.3 MB（11.8 MiB）、予定は …" (formatUploadSize), or grouped
 * bytes when the two would read the same.
 */
export const sizeMismatch = (actual: number, expected: number): string => {
  let a = formatUploadSize(actual);
  let e = formatUploadSize(expected);
  if (a === e) {
    a = `${groupDigits(actual)} バイト`;
    e = `${groupDigits(expected)} バイト`;
  }
  return `B2 は ${a}、予定は ${e}`;
};

/** What the bucket has at a path (HEAD), or null when nothing is there. */
export type ObjectStat = { size: number; sha256: string | null };

export type CompleteOutcome =
  | { kind: "ready" }
  | { kind: "not-found" }
  /** The bucket has no file at the row's path. */
  | { kind: "missing" }
  /** The file in the bucket is not the one that was announced. */
  | { kind: "mismatch"; message: string };

/**
 * Mark an upload ready once the bucket has the announced file: `stat`
 * (the image Worker's HEAD, which can read the bucket) must report the
 * row's size and SHA-256 metadata. "ready" also when the row already was
 * (the browser may retry a complete whose response it lost).
 */
export const completeUpload = async (
  db: D1Database,
  id: number,
  stat: (file: string) => Promise<ObjectStat | null>,
): Promise<CompleteOutcome> => {
  const row = await db
    .prepare("SELECT file, status, size, sha256 FROM media WHERE id = ?")
    .bind(id)
    .first<{
      file: string;
      status: string;
      size: number | null;
      sha256: string | null;
    }>();
  if (!row) return { kind: "not-found" };
  if (row.status === "ready") return { kind: "ready" };
  const object = await stat(row.file);
  if (!object) return { kind: "missing" };
  if (row.size !== null && object.size !== row.size) {
    return {
      kind: "mismatch",
      message: `大きさが違います：${sizeMismatch(object.size, row.size)}です。`,
    };
  }
  if (row.sha256 !== null && object.sha256 !== row.sha256) {
    return {
      kind: "mismatch",
      message: "中身が違います (SHA-256 が一致しません)",
    };
  }
  const [, after] = await db.batch([
    db
      .prepare(
        `UPDATE media SET status = 'ready',
           uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND status = 'uploading'`,
      )
      .bind(id),
    db.prepare("SELECT status FROM media WHERE id = ?").bind(id),
  ]);
  const now = (after.results ?? [])[0] as { status: string } | undefined;
  // Deleted meanwhile (incomplete uploads can be deleted).
  return now?.status === "ready" ? { kind: "ready" } : { kind: "not-found" };
};

/**
 * Forget an upload that never completed (only `uploading` rows; a ready
 * photo is never deleted here). A file the PUT may have stored stays in
 * the bucket, unreferenced and not served; uploading to the same path
 * again replaces it.
 */
export const deleteIncompleteUpload = async (
  db: D1Database,
  id: number,
): Promise<boolean> => {
  const res = await db
    .prepare("DELETE FROM media WHERE id = ? AND status = 'uploading'")
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
};

export type IncompleteUpload = {
  id: number;
  file: string;
  /** Where it is shown (its folder in the Files view). */
  path: string;
  size: number | null;
  updated_at: string;
};

/** Every upload that has not completed, by file. */
export const listIncompleteUploads = async (
  db: D1Database,
): Promise<IncompleteUpload[]> => {
  const res = await db
    .prepare(
      "SELECT id, file, path, size, updated_at FROM media WHERE status = 'uploading' AND trashed_at IS NULL ORDER BY path",
    )
    .all<IncompleteUpload>();
  return res.results ?? [];
};
