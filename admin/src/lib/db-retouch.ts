// A photo's retouched versions (media_file role 'edit', 0013 / 0020): the
// files the edit page lists, which one the public site shows, adding one
// (a browser-direct upload, like an original) and removing one (to the
// trash, deleted for good from there). Covered by db-retouch.spec.ts on
// the real schema.

import {
  initLookups,
  isUniqueError,
  numberedPaths,
  sizeMismatch,
  type ObjectStat,
} from "./db-upload";
import { contentVersionStatement } from "./last-good";
import type { FileObject } from "./media-file";
import {
  normalizeXmpSummary,
  PHOTO_META_PARSER_DATE,
  type XmpSummary,
} from "./photo-meta";
import { DISPLAY_CONTENT_TYPE, DISPLAY_DIR, type UploadInit } from "./upload";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** media_file.trashed_at of an edit being deleted for good (purgeEdits). */
const PURGING = "purging:";

/** One file of a photo the edit page lists: its original or an edit. */
export type PhotoFile = {
  id: number;
  role: "original" | "edit";
  /** Its bucket key (never changes). */
  key: string;
  /** What its thumbnail is made from: its display copy, else itself. */
  thumbKey: string;
  size: number | null;
  mimeType: string | null;
  /** The program that wrote it (XMP CreatorTool, else EXIF Software). */
  creatorTool: string | null;
  xmpSummary: XmpSummary | null;
  /** When it was uploaded (or the row made, for files from before). */
  addedAt: string | null;
  /** The file the public site shows. */
  shown: boolean;
};

/**
 * The ready original and edits of photo ?1 that are not removed, the
 * original first, with each one's newest ready display copy (by
 * idx_media_file_media, then idx_media_file_source).
 */
export const PHOTO_FILES_SQL = `SELECT f.id, f.role, f.object_key AS key,
    f.size, f.mime_type, f.creator_tool, f.xmp_summary,
    COALESCE(f.uploaded_at, f.created_at) AS added_at,
    (SELECT dc.object_key FROM media_file dc
     WHERE dc.source_file_id = f.id AND dc.role = 'display'
       AND dc.status = 'ready' AND dc.media_id = f.media_id
     ORDER BY dc.id DESC LIMIT 1) AS display_key,
    f.id = COALESCE(m.active_file_id,
      (SELECT o.id FROM media_file o
       WHERE o.media_id = m.id AND o.role = 'original')) AS shown
  FROM media m JOIN media_file f ON f.media_id = m.id
  WHERE m.id = ?1 AND f.role IN ('original', 'edit') AND f.status = 'ready'
    AND f.storage = 'b2' AND f.trashed_at IS NULL
  ORDER BY f.role = 'edit', f.id`;

type FileRow = {
  id: number;
  role: "original" | "edit";
  key: string;
  size: number | null;
  mime_type: string | null;
  creator_tool: string | null;
  xmp_summary: string | null;
  added_at: string | null;
  display_key: string | null;
  shown: number;
};

const parseSummary = (raw: string | null): XmpSummary | null => {
  if (!raw) return null;
  try {
    return normalizeXmpSummary(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const listPhotoFiles = async (
  db: D1Database,
  mediaId: number,
): Promise<PhotoFile[]> => {
  const rows =
    (await db.prepare(PHOTO_FILES_SQL).bind(mediaId).all<FileRow>()).results ??
    [];
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    key: r.key,
    thumbKey: r.display_key ?? r.key,
    size: r.size,
    mimeType: r.mime_type,
    creatorTool: r.creator_tool,
    xmpSummary: parseSummary(r.xmp_summary),
    addedAt: r.added_at,
    shown: r.shown === 1,
  }));
};

/** Why a change of the files could not be made, in words for the page. */
export class FileChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileChangeError";
  }
}

/**
 * Show `fileId` (an original or a ready edit of the photo, not removed;
 * the trigger of 0020 checks it) on the public site. The original is
 * stored as NULL. Returns the file shown before, for undo (null = the
 * original). The image Worker resizes the new file (its copies are made
 * again, 0018's trigger), and the API answers change (its size), so the
 * content version moves in the same batch.
 */
export const setShownFile = async (
  db: D1Database,
  mediaId: number,
  fileId: number,
): Promise<{ previous: number }> => {
  const [before] = await db.batch<{
    shown: number | null;
    original: number | null;
  }>([
    db
      .prepare(
        `SELECT COALESCE(m.active_file_id, o.id) AS shown, o.id AS original
         FROM media m JOIN media_file o ON o.media_id = m.id AND o.role = 'original'
         WHERE m.id = ?1`,
      )
      .bind(mediaId),
  ]);
  const row = (before.results ?? [])[0];
  if (!row || row.shown === null)
    throw new FileChangeError("この写真はもうありません");
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE media SET active_file_id = CASE WHEN ?2 = ?3 THEN NULL ELSE ?2 END,
             updated_at = ${NOW}
           WHERE id = ?1 AND active_file_id IS NOT (CASE WHEN ?2 = ?3 THEN NULL ELSE ?2 END)`,
        )
        .bind(mediaId, fileId, row.original),
      contentVersionStatement(db),
    ]);
  } catch (err) {
    if (err instanceof Error && /active_file_id must be/.test(err.message)) {
      throw new FileChangeError("このファイルは表示できません（再読み込み）");
    }
    throw err;
  }
  return { previous: row.shown };
};

/**
 * Remove an edit of the photo (it goes to the trash; its object stays
 * until it is deleted for good there). Not the file the photo shows (the
 * trigger of 0020 refuses it). Nothing public changes. False when there
 * was no such edit.
 */
export const trashEdit = async (
  db: D1Database,
  mediaId: number,
  fileId: number,
): Promise<boolean> => {
  try {
    const r = await db
      .prepare(
        `UPDATE media_file SET trashed_at = ${NOW}
         WHERE id = ?2 AND media_id = ?1 AND role = 'edit'
           AND trashed_at IS NULL`,
      )
      .bind(mediaId, fileId)
      .run();
    return (r.meta.changes ?? 0) > 0;
  } catch (err) {
    if (err instanceof Error && /only an edit/.test(err.message)) {
      throw new FileChangeError(
        "公開サイトに表示しているファイルは外せません。先に別のファイルを表示してください",
      );
    }
    throw err;
  }
};

/** Take removed edits out of the trash (each back to its photo). */
export const restoreEdits = async (
  db: D1Database,
  fileIds: readonly number[],
): Promise<number> => {
  if (fileIds.length === 0) return 0;
  const r = await db
    .prepare(
      `UPDATE media_file SET trashed_at = NULL
       WHERE id IN (SELECT value FROM json_each(?1)) AND trashed_at IS NOT NULL
         AND trashed_at NOT LIKE '${PURGING}%'`,
    )
    .bind(JSON.stringify(fileIds))
    .run();
  return r.meta.changes ?? 0;
};

export type TrashedEdit = {
  id: number;
  mediaId: number;
  /** The photo's path (where it is shown). */
  photoPath: string;
  key: string;
  thumbKey: string;
  size: number | null;
  creatorTool: string | null;
  trashedAt: string;
};

/** The removed edits, most recently removed first (idx_media_file_trashed). */
export const listTrashedEdits = async (
  db: D1Database,
): Promise<TrashedEdit[]> => {
  const rows =
    (
      await db
        .prepare(
          `SELECT f.id, f.media_id, m.path, f.object_key AS key, f.size,
             f.creator_tool, f.trashed_at,
             (SELECT dc.object_key FROM media_file dc
              WHERE dc.source_file_id = f.id AND dc.role = 'display'
                AND dc.status = 'ready' AND dc.media_id = f.media_id
              ORDER BY dc.id DESC LIMIT 1) AS display_key
           FROM media_file f JOIN media m ON m.id = f.media_id
           WHERE f.trashed_at IS NOT NULL
           ORDER BY f.trashed_at DESC, f.id DESC`,
        )
        .all<{
          id: number;
          media_id: number;
          path: string;
          key: string;
          size: number | null;
          creator_tool: string | null;
          trashed_at: string;
          display_key: string | null;
        }>()
    ).results ?? [];
  return rows.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    photoPath: r.path,
    key: r.key,
    thumbKey: r.display_key ?? r.key,
    size: r.size,
    creatorTool: r.creator_tool,
    trashedAt: r.trashed_at.startsWith(PURGING)
      ? r.trashed_at.slice(PURGING.length)
      : r.trashed_at,
  }));
};

/**
 * Delete removed edits for good: every version of the edit's object and
 * of the copies made from it (`removeObject`), then their rows. A failure
 * leaves that edit (and its rows) for a retry; only removed edits are
 * touched.
 */
export const purgeEdits = async (
  db: D1Database,
  fileIds: readonly number[],
  removeObject: (object: FileObject) => Promise<void>,
): Promise<{ deleted: number[]; failed: { id: number; error: string }[] }> => {
  // Claimed first ("purging:<when it was removed>"): a claimed edit is not
  // put back meanwhile (restoreEdits), so no object of a live edit is
  // deleted. A claim is given up again when nothing of it was deleted.
  const [, claimed] = await db.batch([
    db
      .prepare(
        `UPDATE media_file SET trashed_at = '${PURGING}' || trashed_at
         WHERE id IN (SELECT value FROM json_each(?1))
           AND trashed_at IS NOT NULL AND role = 'edit'
           AND trashed_at NOT LIKE '${PURGING}%'`,
      )
      .bind(JSON.stringify(fileIds)),
    db
      .prepare(
        `SELECT f.id, f.storage, f.object_key AS key, d.id AS copy_id,
           d.storage AS copy_storage, d.object_key AS copy_key
         FROM media_file f
         LEFT JOIN media_file d ON d.source_file_id = f.id
         WHERE f.id IN (SELECT value FROM json_each(?1))
           AND f.trashed_at LIKE '${PURGING}%' AND f.role = 'edit'
         ORDER BY f.id, d.id`,
      )
      .bind(JSON.stringify(fileIds)),
  ]);
  const rows =
    (
      claimed as D1Result<{
        id: number;
        storage: string;
        key: string;
        copy_id: number | null;
        copy_storage: string | null;
        copy_key: string | null;
      }>
    ).results ?? [];
  const edits = new Map<number, { edit: FileObject; copies: FileObject[] }>();
  for (const r of rows) {
    let e = edits.get(r.id);
    if (!e) {
      e = {
        edit: { storage: r.storage === "r2" ? "r2" : "b2", key: r.key },
        copies: [],
      };
      edits.set(r.id, e);
    }
    if (r.copy_key) {
      e.copies.push({
        storage: r.copy_storage === "r2" ? "r2" : "b2",
        key: r.copy_key,
      });
    }
  }
  const result = {
    deleted: [] as number[],
    failed: [] as { id: number; error: string }[],
  };
  for (const [id, e] of edits) {
    let removed = 0;
    try {
      for (const o of [...e.copies, e.edit]) {
        if (o.storage !== "b2")
          throw new Error(`${o.storage} のファイルはまだ削除できません`);
        await removeObject(o);
        removed++;
      }
      await db.batch([
        db.prepare("DELETE FROM media_file WHERE source_file_id = ?1").bind(id),
        db
          .prepare(
            "DELETE FROM media_file WHERE id = ?1 AND trashed_at IS NOT NULL",
          )
          .bind(id),
      ]);
      result.deleted.push(id);
    } catch (err) {
      // Nothing deleted (e.g. no permission): it can be put back again.
      if (removed === 0) {
        await db
          .prepare(
            `UPDATE media_file SET trashed_at = substr(trashed_at, ${PURGING.length + 1})
             WHERE id = ?1 AND trashed_at LIKE '${PURGING}%'`,
          )
          .bind(id)
          .run()
          .catch(() => {});
      }
      result.failed.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
};

export type EditInitOutcome =
  | {
      kind: "upload";
      /** The edit's media_file row. */
      id: number;
      file: string;
      resumed: boolean;
      /** Its display copy's key, when the init has one. */
      display?: string;
    }
  /** The photo already has this file (a removed one is put back). */
  | { kind: "exists"; id: number; file: string }
  | { kind: "conflict"; message: string; retry: boolean };

/**
 * A display copy of the edit at ?1 (an edit over the resize limits),
 * still uploading, made from it, at a key of the photo's public id and
 * the copy's hash (like an original's, db-upload.ts). RETURNING its key.
 */
const editDisplayStatement = (
  db: D1Database,
  editKey: string,
  display: NonNullable<UploadInit["display"]>,
) =>
  db
    .prepare(
      `INSERT INTO media_file (media_id, role, storage, object_key,
         source_file_id, status, size, sha256, mime_type)
       SELECT e.media_id, 'display', 'b2',
         '${DISPLAY_DIR}' || m.public_id || '-' || substr(?3, 1, 16) || '.jpg',
         e.id, 'uploading', ?2, ?3, '${DISPLAY_CONTENT_TYPE}'
       FROM media_file e JOIN media m ON m.id = e.media_id
       WHERE e.storage = 'b2' AND e.object_key = ?1 AND e.role = 'edit'
         AND e.status = 'uploading'
       ON CONFLICT (storage, object_key) DO UPDATE
         SET size = excluded.size, sha256 = excluded.sha256
         WHERE media_file.status = 'uploading'
           AND media_file.source_file_id = excluded.source_file_id
       RETURNING object_key`,
    )
    .bind(editKey, display.size, display.sha256);

/**
 * Reserve a key for a retouched version of photo `mediaId` uploaded as
 * `init.file` (in the photo's folder): a media_file row (role edit, made
 * from the photo's original) that is `uploading` until the completion.
 * A taken name gets the first free numbered one, as for photos. The same
 * bytes as any file of any photo are refused, except this photo's own
 * edit: a removed one comes back, an incomplete one is resumed. The
 * metadata the browser read stays on the edit's row; nothing of it
 * becomes the photo's.
 */
export const initEditUpload = async (
  db: D1Database,
  mediaId: number,
  init: UploadInit,
): Promise<EditInitOutcome> => {
  const [photo, sameRows] = await db.batch<{
    id: number;
    media_id?: number;
    role?: string;
    status?: string;
    key?: string;
    trashed_at?: string | null;
    path?: string;
  }>([
    db
      .prepare(
        `SELECT id FROM media WHERE id = ?1 AND status = 'ready' AND trashed_at IS NULL`,
      )
      .bind(mediaId),
    db
      .prepare(
        `SELECT f.id, f.media_id, f.role, f.status, f.object_key AS key,
           f.trashed_at, m.path
         FROM media_file f JOIN media m ON m.id = f.media_id
         WHERE f.sha256 = ?1`,
      )
      .bind(init.sha256),
  ]);
  if ((photo.results ?? []).length === 0) {
    return {
      kind: "conflict",
      message: "この写真はもうありません（再読み込み）",
      retry: false,
    };
  }
  const same = (sameRows.results ?? [])[0];
  if (same) {
    if (same.media_id !== mediaId) {
      return {
        kind: "conflict",
        message: `同じファイルが別の写真にあります (${same.path})`,
        retry: false,
      };
    }
    if (same.role === "original") {
      return {
        kind: "conflict",
        message: "この写真の元のファイルと同じです",
        retry: false,
      };
    }
    if (same.role !== "edit") {
      return {
        kind: "conflict",
        message: "この写真の縮小版と同じファイルです",
        retry: false,
      };
    }
    if (same.status === "ready") {
      if (same.trashed_at) await restoreEdits(db, [same.id]);
      return { kind: "exists", id: same.id, file: same.key ?? "" };
    }
    // An earlier attempt: resumed at its key (and its display copy as
    // this attempt announces it).
    const resumed = {
      kind: "upload" as const,
      id: same.id,
      file: same.key ?? "",
      resumed: true,
    };
    if (!init.display) return resumed;
    try {
      const [, written] = await db.batch<{ object_key: string }>([
        db
          .prepare(
            `DELETE FROM media_file WHERE source_file_id = ?1 AND role = 'display'
               AND status = 'uploading'
               AND object_key IS NOT (SELECT '${DISPLAY_DIR}' || m.public_id || '-' || substr(?2, 1, 16) || '.jpg'
                                      FROM media m WHERE m.id = ?3)`,
          )
          .bind(same.id, init.display.sha256, mediaId),
        editDisplayStatement(db, resumed.file, init.display),
      ]);
      const key = (written.results ?? [])[0]?.object_key;
      if (!key) throw new Error("display copy row not written");
      return { ...resumed, display: key };
    } catch (err) {
      if (isUniqueError(err)) {
        return {
          kind: "conflict",
          message: "別のアップロードと重なりました",
          retry: true,
        };
      }
      throw err;
    }
  }
  // A free name, as for an original (keys of every file, camera pictures,
  // paths of photos).
  const [, ...byName] = await db.batch<{ file?: string; path?: string }>(
    initLookups(init.sha256, init.file).map((q) =>
      db.prepare(q.sql).bind(...q.args),
    ),
  );
  const [keyIs, keyIn, pictureIs, pictureIn, ...byPath] = byName;
  const taken = new Set([
    ...[keyIs, keyIn, pictureIs, pictureIn]
      .flatMap((r) => r.results ?? [])
      .map((r) => r.file),
    ...byPath.flatMap((r) => r.results ?? []).map((r) => r.path),
  ]);
  const file = numberedPaths(init.file).find((c) => !taken.has(c));
  if (!file) {
    return {
      kind: "conflict",
      message: `${init.file} と同じ名前が多すぎます`,
      retry: false,
    };
  }
  const fileExif = init.meta?.fileExif ?? null;
  const creatorTool = init.hints?.creatorTool ?? fileExif?.software ?? null;
  const summary = init.hints?.xmpSummary ?? null;
  try {
    const out = await db.batch<{ id: number; object_key: string }>([
      db
        .prepare(
          `INSERT INTO media_file (media_id, role, storage, object_key,
             source_file_id, status, size, sha256, mime_type, file_exif,
             creator_tool, xmp_summary, metadata_read_at)
           SELECT ?1, 'edit', 'b2', ?2, o.id, 'uploading', ?3, ?4, ?5, ?6, ?7, ?8,
             CASE WHEN ?9 THEN MAX(${NOW}, ?10) END
           FROM media_file o WHERE o.media_id = ?1 AND o.role = 'original'
           RETURNING id, object_key`,
        )
        .bind(
          mediaId,
          file,
          init.size,
          init.sha256,
          init.contentType,
          fileExif ? JSON.stringify(fileExif) : null,
          creatorTool,
          summary ? JSON.stringify(summary) : null,
          // Read in the browser with today's parser: the reader skips it.
          init.meta && init.parserDate === PHOTO_META_PARSER_DATE ? 1 : 0,
          PHOTO_META_PARSER_DATE,
        ),
      ...(init.display ? [editDisplayStatement(db, file, init.display)] : []),
    ]);
    const row = out[0].results?.[0];
    if (!row) throw new Error("INSERT INTO media_file returned no row");
    const display = init.display ? out[1].results?.[0]?.object_key : undefined;
    if (init.display && !display)
      throw new Error("display copy row not written");
    return {
      kind: "upload",
      id: row.id,
      file,
      resumed: false,
      ...(display ? { display } : {}),
    };
  } catch (err) {
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

export type EditCompleteOutcome =
  | { kind: "ready" }
  | { kind: "not-found" }
  | { kind: "missing" }
  | { kind: "mismatch"; message: string };

/**
 * Mark an edit ready once the bucket has it as announced (`stat`, the
 * image Worker's AdminImage.stat), with its display copies. Nothing
 * public changes: a new edit is not shown until it is chosen.
 */
export const completeEditUpload = async (
  db: D1Database,
  mediaId: number,
  fileId: number,
  stat: (file: string) => Promise<ObjectStat | null>,
): Promise<EditCompleteOutcome> => {
  const files =
    (
      await db
        .prepare(
          `SELECT id, role, object_key AS file, status, size, sha256
           FROM media_file
           WHERE (id = ?2 AND media_id = ?1 AND role = 'edit')
              OR (source_file_id = ?2 AND role = 'display' AND status = 'uploading')
           ORDER BY id`,
        )
        .bind(mediaId, fileId)
        .all<{
          id: number;
          role: string;
          file: string;
          status: string;
          size: number | null;
          sha256: string | null;
        }>()
    ).results ?? [];
  const edit = files.find((f) => f.id === fileId);
  if (!edit) return { kind: "not-found" };
  if (edit.status === "ready") return { kind: "ready" };
  const copies = files.filter((f) => f.id !== fileId);
  const object = await stat(edit.file);
  if (!object) return { kind: "missing" };
  if (edit.size !== null && object.size !== edit.size) {
    return {
      kind: "mismatch",
      message: `大きさが違います：${sizeMismatch(object.size, edit.size)}です。`,
    };
  }
  if (edit.sha256 !== null && object.sha256 !== edit.sha256) {
    return {
      kind: "mismatch",
      message: "中身が違います (SHA-256 が一致しません)",
    };
  }
  for (const c of copies) {
    const copy = await stat(c.file);
    if (
      !copy ||
      (c.size !== null && copy.size !== c.size) ||
      (c.sha256 !== null && copy.sha256 !== c.sha256)
    ) {
      return {
        kind: "mismatch",
        message: "アップロードが完了していません。もう一度試してください。",
      };
    }
  }
  const out = await db.batch<{ status: string }>([
    ...copies.map((c) =>
      db
        .prepare(
          `UPDATE media_file SET status = 'ready', uploaded_at = ${NOW}
           WHERE id = ?1 AND status = 'uploading' AND size IS ?2 AND sha256 IS ?3`,
        )
        .bind(c.id, c.size, c.sha256),
    ),
    db
      .prepare(
        `UPDATE media_file SET status = 'ready', upload_id = NULL, uploaded_at = ${NOW}
         WHERE id = ?1 AND status = 'uploading'
           AND NOT EXISTS (SELECT 1 FROM media_file d
             WHERE d.source_file_id = ?1 AND d.role = 'display' AND d.status <> 'ready')`,
      )
      .bind(fileId),
    db.prepare("SELECT status FROM media_file WHERE id = ?1").bind(fileId),
  ]);
  const now = (out[out.length - 1].results ?? [])[0];
  if (!now) return { kind: "not-found" };
  return now.status === "ready"
    ? { kind: "ready" }
    : {
        kind: "mismatch",
        message: "アップロードが完了していません。もう一度試してください。",
      };
};

/**
 * Forget an edit upload that never completed (only an `uploading` edit
 * row of the photo, and its copies' rows). Its object, if the PUT went
 * through, is left in the bucket unreferenced.
 */
export const deleteIncompleteEdit = async (
  db: D1Database,
  mediaId: number,
  fileId: number,
): Promise<boolean> => {
  const [, deleted] = await db.batch([
    db
      .prepare(
        `DELETE FROM media_file WHERE source_file_id = ?2 AND role = 'display'
           AND EXISTS (SELECT 1 FROM media_file e WHERE e.id = ?2
             AND e.media_id = ?1 AND e.role = 'edit' AND e.status = 'uploading')`,
      )
      .bind(mediaId, fileId),
    db
      .prepare(
        `DELETE FROM media_file WHERE id = ?2 AND media_id = ?1 AND role = 'edit'
           AND status = 'uploading'`,
      )
      .bind(mediaId, fileId),
  ]);
  return (deleted.meta.changes ?? 0) > 0;
};

/** The edit uploads of photo ?1 that never completed. */
export const listIncompleteEdits = async (
  db: D1Database,
  mediaId: number,
): Promise<{ id: number; key: string; size: number | null }[]> =>
  (
    await db
      .prepare(
        `SELECT id, object_key AS key, size FROM media_file
         WHERE media_id = ?1 AND role = 'edit' AND status = 'uploading'
         ORDER BY id`,
      )
      .bind(mediaId)
      .all<{ id: number; key: string; size: number | null }>()
  ).results ?? [];
