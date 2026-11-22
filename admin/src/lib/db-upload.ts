// D1 side of uploads (see 0004_upload.sql): reserve a row before the PUT,
// mark it ready after, and list / drop the ones that never completed.
// Covered by db-upload.spec.ts on the real schema.

import {
  deviceIdArgs,
  deviceIdSql,
  deviceOf,
  ensureDeviceStatement,
} from "./device";
import { displaySize, type ImageSize } from "./image-size";
import { contentVersionStatement } from "./last-good";
import type { MetadataOverrides } from "./metadata";
import { serializeSources } from "./metadata-source";
import {
  EMPTY_STORED,
  PHOTO_META_PARSER_DATE,
  type StoredMeta,
} from "./photo-meta";
import {
  DISPLAY_CONTENT_TYPE,
  DISPLAY_DIR,
  formatUploadSize,
  groupDigits,
  type DisplayInit,
  type UploadInit,
} from "./upload";

/**
 * The completion's answer when a display copy is missing or not the one
 * announced: the copy is the uploader's own business, so the words are
 * about the upload.
 */
export const NOT_COMPLETE =
  "アップロードが完了していません。もう一度試してください。";

/** displayKey in SQL, from the photo `m`'s public id and the hash `?3`. */
const DISPLAY_KEY_SQL = `'${DISPLAY_DIR}' || m.public_id || '-' || substr(?3, 1, 16) || '.jpg'`;
import type { MediaPlatform, Visibility } from "./types";

/** media columns (0005) for metadata read from the file itself. */
export const metaColumns = (meta: StoredMeta) => ({
  exif: meta.exif ? JSON.stringify(meta.exif) : null,
  latitude: meta.location?.latitude ?? null,
  longitude: meta.location?.longitude ?? null,
  location_source: meta.location ? ("exif" as const) : null,
  world_id: meta.world?.id ?? null,
  world_name: meta.world?.name ?? null,
  photographer_id: meta.photographer?.id ?? null,
  photographer_name: meta.photographer?.name ?? null,
  vrcx: meta.vrcx ? JSON.stringify(meta.vrcx) : null,
  file_exif: meta.fileExif ? JSON.stringify(meta.fileExif) : null,
  digitized_at: meta.digitizedAt,
});

/**
 * media.width / height (0016) of an upload: the header's size as the photo
 * is displayed (turned by its EXIF orientation). Only when the browser
 * read the file's metadata, since the orientation is unknown otherwise;
 * the metadata reader fills it in then.
 */
export const displaySizeOf = (
  init: Pick<UploadInit, "dimensions" | "meta">,
): ImageSize | null =>
  init.dimensions && init.meta
    ? displaySize(init.dimensions, init.meta.fileExif?.orientation)
    : null;

export type InitOutcome =
  /**
   * Upload to the row `id` at `file` (new, or an earlier attempt being
   * resumed). `file` differs from the requested path when that was taken
   * by another photo ("IMG_0001-1.jpg"), or when the same photo's earlier
   * attempt went elsewhere.
   */
  | {
      kind: "upload";
      id: number;
      file: string;
      resumed: boolean;
      /**
       * Where the display copy goes, when the init has one: its media_file
       * row (role display), uploading until the completion (displayKey).
       */
      display?: string;
    }
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

/** The photo whose file has the upload's hash, and that file's role. */
type BySha = Existing & { role: string; file_status: string };

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
 * What initUpload reads (SQL + bind args, run as one D1 batch): the file
 * with this SHA-256 and its photo, then the rows whose file (the
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
    // Any file of any photo (0013: an original, a retouched version or a
    // copy) with these bytes (idx_media_file_sha256), and its photo.
    {
      sql: `SELECT m.id, m.file, m.path, m.status, f.sha256, m.trashed_at,
              f.role, f.status AS file_status
            FROM media_file f JOIN media m ON m.id = f.media_id
            WHERE f.sha256 = ?`,
      args: [sha256],
    },
    // Bucket keys of every file (0013; an original's is its media.file),
    // by the UNIQUE (storage, object_key) index: two statements, as an OR
    // of the two would make SQLite walk every key in the storage.
    {
      sql: `SELECT object_key AS file FROM media_file
            WHERE storage = 'b2' AND object_key = ?`,
      args: [file],
    },
    {
      sql: `SELECT object_key AS file FROM media_file
            WHERE storage = 'b2' AND object_key >= ?1 AND object_key < ?2`,
      args: [lo, hi],
    },
    // Camera pictures' own objects (0019: a photo never takes one; a
    // trigger refuses it), by idx_camera_image_file.
    {
      sql: `SELECT file FROM camera_image WHERE file = ?`,
      args: [file],
    },
    {
      sql: `SELECT file FROM camera_image WHERE file >= ?1 AND file < ?2`,
      args: [lo, hi],
    },
    // Two statements: SQLite does not split an OR over a partial index.
    { sql: `${select} trashed_at IS NULL AND path = ?`, args: [file] },
    {
      sql: `${select} trashed_at IS NULL AND path >= ?1 AND path < ?2`,
      args: [lo, hi],
    },
  ];
};

/**
 * The display copy of the photo whose original is `file`, still uploading
 * (an original over the resize limits; display-copy.ts): a media_file row
 * (0013) with role display, made from the original, at displayKey (in
 * SQL, from the photo's public id and the hash) with the announced size
 * and hash. Written again on a resume of the same encoding; never touches
 * a row that is ready or another photo's. RETURNING its key, no row when
 * it was not written.
 */
export const displayCopyStatement = (
  db: D1Database,
  file: string,
  display: DisplayInit,
) =>
  db
    .prepare(
      `INSERT INTO media_file (media_id, role, storage, object_key,
         source_file_id, status, size, sha256, mime_type)
       SELECT m.id, 'display', 'b2', ${DISPLAY_KEY_SQL}, o.id, 'uploading',
         ?2, ?3, '${DISPLAY_CONTENT_TYPE}'
       FROM media m JOIN media_file o ON o.media_id = m.id AND o.role = 'original'
       WHERE m.file = ?1 AND m.status = 'uploading'
       ON CONFLICT (storage, object_key) DO UPDATE
         SET size = excluded.size, sha256 = excluded.sha256
         WHERE media_file.status = 'uploading'
           AND media_file.media_id = excluded.media_id
           AND media_file.role = 'display'
       RETURNING object_key`,
    )
    .bind(file, display.size, display.sha256);

// The photo's original row (media_file, 0013) is inserted by a trigger in
// the same statement, so its UNIQUE indexes can refuse it too.
export const isUniqueError = (err: unknown) =>
  err instanceof Error &&
  /UNIQUE constraint failed: media(_file)?\./.test(err.message);

/** What a new row gets besides the file's own data (the upload rules). */
export type NewRow = {
  publicId: string;
  platform: MediaPlatform;
  cameraId?: number | null;
  tags?: readonly string[];
  /** Private unless a rule says otherwise. */
  visibility?: Visibility;
  metadataVisibility?: MetadataOverrides;
};

/**
 * Reserve a path for an upload of `init.file`. A new row is `uploading`,
 * with the given public id, platform, camera, tags, visibility (private
 * by default) and metadata levels; when another photo
 * already has that path, the first free numbered name is used instead
 * (numberedPaths). An `uploading` row with the same hash is resumed (a
 * retry, or picking the same file again after a failure).
 */
export const initUpload = async (
  db: D1Database,
  init: UploadInit,
  row: NewRow,
): Promise<InitOutcome> => {
  const candidates = numberedPaths(init.file);
  const [bySha, ...byName] = await db.batch<Existing>(
    initLookups(init.sha256, init.file).map((q) =>
      db.prepare(q.sql).bind(...q.args),
    ),
  );
  const same = (bySha.results ?? [])[0] as BySha | undefined;
  if (same) {
    if (same.role !== "original") {
      // A retouched version or a copy of a photo: the photo has it.
      return same.trashed_at === null && same.file_status === "ready"
        ? { kind: "exists", id: same.id, file: same.path }
        : {
            kind: "conflict",
            message: `同じファイルが別の写真にあります (${same.path})`,
            retry: false,
          };
    }
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
    const resumed = {
      kind: "upload" as const,
      id: same.id,
      file: same.file,
      resumed: true,
    };
    if (!init.display) return resumed;
    // Its display copy's row as this attempt announces it, in place of
    // any other encoding an earlier attempt announced (whose object, if
    // its PUT went through, is left over unread).
    const copy = await db
      .batch<{ object_key: string }>([
        db
          .prepare(
            `DELETE FROM media_file
             WHERE role = 'display' AND status = 'uploading'
               AND media_id = (SELECT id FROM media
                               WHERE file = ?1 AND status = 'uploading')
               AND object_key IS NOT (
                 SELECT '${DISPLAY_DIR}' || m.public_id || '-' || substr(?2, 1, 16) || '.jpg'
                 FROM media m WHERE m.file = ?1)`,
          )
          .bind(same.file, init.display.sha256),
        displayCopyStatement(db, same.file, init.display),
      ])
      .then(([, written]) => (written.results ?? [])[0] ?? null)
      .catch((err: unknown) => {
        if (isUniqueError(err)) return null;
        throw err;
      });
    // Completed or deleted meanwhile, or those bytes are another file's:
    // the browser asks again.
    if (!copy) {
      return {
        kind: "conflict",
        message: `${same.path} は別のアップロードと重なりました`,
        retry: true,
      };
    }
    return { ...resumed, display: copy.object_key };
  }
  // A name is taken by another file in the bucket (any row: keys never
  // change; a camera picture's too) or by a photo shown there (path, not
  // trashed: moved photos). The lookups may return other names too; only
  // the candidates count.
  const [keyIs, keyIn, pictureIs, pictureIn, ...byPath] = byName;
  const taken = new Set([
    ...[keyIs, keyIn, pictureIs, pictureIn]
      .flatMap((r) => r.results ?? [])
      .map((r) => r.file),
    ...byPath.flatMap((r) => r.results ?? []).map((r) => r.path),
  ]);
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
    // A camera an upload rule sets is a choice made in advance, as on the
    // edit page: the metadata reader never replaces it.
    ...(row.cameraId != null ? { camera: "manual" as const } : {}),
  });
  // The camera (or scanner) the file names: its row, created first when
  // there is none (device.ts), in the same batch. Not the camera when a
  // rule set one.
  const named = deviceOf(init.meta ?? {}, row.platform);
  const device =
    named && !(named.role === "camera" && row.cameraId != null) ? named : null;
  const deviceId = deviceIdSql("?20", "?21", "?22", "?23");
  const size = displaySizeOf(init);
  try {
    const insert = db
      .prepare(
        `INSERT INTO media (public_id, file, path, platform, timestamp, tags, visibility, status, size, sha256,
           exif, latitude, longitude, location_source, world_id, world_name, photographer_id, metadata_read_at,
           metadata_source, file_exif, digitized_at, camera_id, digitized_with,
           metadata_visibility, width, height, photographer_name, vrcx)
         VALUES (?1, ?2, ?2, ?3, ?4, ?24, ?25, 'uploading', ?5, ?6,
           ?7, ?8, ?9, ?10, ?11, ?12, ?13,
           CASE WHEN ?14 THEN MAX(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?16) END, ?15,
           ?17, ?18,
           CASE WHEN ?26 IS NOT NULL THEN ?26
                WHEN ?19 = 'camera' THEN ${deviceId} END,
           CASE WHEN ?19 = 'digitizer' THEN ${deviceId} END,
           ?27, ?28, ?29, ?30, ?31) RETURNING id`,
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
        meta.photographer_id,
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
        JSON.stringify(row.tags ?? []),
        row.visibility ?? "private",
        row.cameraId ?? null,
        row.metadataVisibility && Object.keys(row.metadataVisibility).length > 0
          ? JSON.stringify(row.metadataVisibility)
          : null,
        size?.width ?? null,
        size?.height ?? null,
        meta.photographer_name,
        meta.vrcx,
      );
    // What wrote the file, on the original's media_file row (0013; the
    // trigger created it with the INSERT): what the reader would write.
    const creatorTool =
      init.hints?.creatorTool ?? init.meta?.fileExif?.software ?? null;
    const xmpSummary = init.hints?.xmpSummary ?? null;
    const tool =
      creatorTool !== null || xmpSummary !== null
        ? db
            .prepare(
              `UPDATE media_file SET creator_tool = ?2, xmp_summary = ?3
               WHERE media_id = (SELECT id FROM media WHERE file = ?1)
                 AND role = 'original'`,
            )
            .bind(
              file,
              creatorTool,
              xmpSummary ? JSON.stringify(xmpSummary) : null,
            )
        : null;
    // An original over the resize limits: its display copy's row, in the
    // same batch (a photo never has one without the other).
    const copy = init.display
      ? displayCopyStatement(db, file, init.display)
      : null;
    const out = await db.batch<{ id: number; object_key: string }>([
      ...(device?.create ? [ensureDeviceStatement(db, device)] : []),
      insert,
      ...(tool ? [tool] : []),
      ...(copy ? [copy] : []),
    ]);
    const inserted = out[device?.create ? 1 : 0].results?.[0];
    if (!inserted) throw new Error("INSERT INTO media returned no row");
    const display = copy ? out[out.length - 1].results?.[0]?.object_key : null;
    if (copy && !display) throw new Error("display copy row not written");
    return {
      kind: "upload",
      id: inserted.id,
      file,
      resumed: false,
      ...(display ? { display } : {}),
    };
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
  // The photo's original (media_file, 0013; the same values as media's
  // columns, which the trigger keeps in step).
  const row = await db
    .prepare(
      `SELECT f.object_key AS file, f.status, f.size, f.sha256, m.visibility
       FROM media_file f JOIN media m ON m.id = f.media_id
       WHERE f.media_id = ? AND f.role = 'original' AND f.storage = 'b2'`,
    )
    .bind(id)
    .first<{
      file: string;
      status: string;
      size: number | null;
      sha256: string | null;
      visibility: string;
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
  // Its display copy (an original over the resize limits; media_file role
  // display, still uploading): the bucket must have it too, as announced.
  const copies =
    (
      await db
        .prepare(
          `SELECT id, object_key AS file, size, sha256 FROM media_file
           WHERE media_id = ? AND role = 'display' AND status = 'uploading'
             AND storage = 'b2'`,
        )
        .bind(id)
        .all<{
          id: number;
          file: string;
          size: number | null;
          sha256: string | null;
        }>()
    ).results ?? [];
  for (const c of copies) {
    const copy = await stat(c.file);
    if (!copy) {
      return { kind: "mismatch", message: NOT_COMPLETE };
    }
    if (
      (c.size !== null && copy.size !== c.size) ||
      (c.sha256 !== null && copy.sha256 !== c.sha256)
    ) {
      return {
        kind: "mismatch",
        message: NOT_COMPLETE,
      };
    }
  }
  const out = await db.batch([
    // Its display copies first, each only as it was checked (a resume may
    // have announced another meanwhile)...
    ...copies.map((c) =>
      db
        .prepare(
          `UPDATE media_file SET status = 'ready',
             uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?1 AND status = 'uploading'
             AND size IS ?2 AND sha256 IS ?3`,
        )
        .bind(c.id, c.size, c.sha256),
    ),
    // ...then the photo, only with every display copy ready: it is never
    // ready without them.
    db
      .prepare(
        `UPDATE media SET status = 'ready',
           uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND status = 'uploading'
           AND NOT EXISTS (SELECT 1 FROM media_file d
             WHERE d.media_id = media.id AND d.role = 'display'
               AND d.status <> 'ready')`,
      )
      // The trigger (0013) marks the original's media_file row ready in
      // the same statement and clears its multipart upload id.
      .bind(id),
    db.prepare("SELECT status FROM media WHERE id = ?").bind(id),
    // Made public or unlisted by an upload rule: the API shows it once it
    // is ready (with its tags and camera), so the content version moves in
    // the same batch. A private one changes nothing the API answers.
    ...(row.visibility !== "private" ? [contentVersionStatement(db)] : []),
  ]);
  const now = (out[copies.length + 1].results ?? [])[0] as
    { status: string } | undefined;
  // Deleted meanwhile (incomplete uploads can be deleted).
  if (!now) return { kind: "not-found" };
  if (now.status === "ready") return { kind: "ready" };
  // Its copy changed under it (a resume): the next try checks it again.
  return {
    kind: "mismatch",
    message: NOT_COMPLETE,
  };
};

/**
 * Forget an upload that never completed (only `uploading` rows; a ready
 * photo is never deleted here). The original the PUT may have stored stays
 * in the bucket, unreferenced and not served; uploading to the same path
 * again replaces it. A display copy's object (an original over the resize
 * limits) is named by the photo's public id, which a new upload never
 * gets again, so it is deleted too (`removeObject`, every version), once
 * the row is gone: a completion running meanwhile then finds no row,
 * rather than a ready photo whose copy was just deleted. If that deletion
 * fails, the object is left over (the error says so).
 */
export const deleteIncompleteUpload = async (
  db: D1Database,
  id: number,
  removeObject: (key: string) => Promise<void>,
): Promise<boolean> => {
  // One batch: the copies' keys and the row (its files go with it), only
  // while it is still uploading.
  const [copies, deleted] = await db.batch<{ key: string }>([
    db
      .prepare(
        `SELECT f.object_key AS key FROM media_file f
         JOIN media m ON m.id = f.media_id
         WHERE f.media_id = ? AND m.status = 'uploading'
           AND f.role = 'display' AND f.storage = 'b2'`,
      )
      .bind(id),
    db
      .prepare("DELETE FROM media WHERE id = ? AND status = 'uploading'")
      .bind(id),
  ]);
  if ((deleted.meta.changes ?? 0) === 0) return false;
  for (const c of copies.results ?? []) await removeObject(c.key);
  return true;
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
