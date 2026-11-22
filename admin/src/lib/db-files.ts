// Lean query for the Files view on /media: only what the folder tree and the
// tiles need, for every row matching the filter. The tree follows `path`
// (where a photo is shown); `file` (the B2 key) is only for its thumbnail.
// Kept apart from db.ts's listMedia, which pages full rows by date for the
// list view.

import { TAKEN_ON_SQL, takenOnArgs } from "./calendar";
import { dirOf } from "./folders";
import { LIVE_PHOTO, type MediaPlatform, type Visibility } from "./types";

export type MediaFileRow = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: Visibility;
  /** Bytes; null for photos from before uploads recorded it. */
  size: number | null;
  /** The photo's public metadata overrides (JSON), for bulk changes. */
  metadata_visibility: string | null;
  /** When it was taken (ISO), if known: sorting and the list layout. */
  timestamp: string | null;
  /** Its camera (`camera.id`), if any: for the bulk camera change. */
  camera_id: number | null;
  /** Its tags (JSON array): which tag fields the selection has. */
  tags: string;
};

export type FilesParams = {
  platform?: MediaPlatform;
  visibility?: Visibility;
  q?: string;
  /** Taken in this year, month or day (the calendar). */
  date?: string;
  limit: number;
};

/**
 * SQL + bind args. Ordered by path so that, past `limit`, the cut is
 * predictable (the alphabetically last paths), and fetching one more row
 * than `limit` tells the caller the result was truncated.
 */
export const filesQuery = (
  params: FilesParams,
): { sql: string; args: unknown[] } => {
  // Not uploads that have not completed (listIncomplete), nor the trash.
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
    // Same LIKE escaping as listMedia: `%` / `_` in the query are literal.
    const escaped = params.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("path LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  if (params.date) {
    where.push(TAKEN_ON_SQL);
    args.push(...takenOnArgs(params.date));
  }
  const whereSql = ` WHERE ${where.join(" AND ")}`;
  return {
    sql: `SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp, camera_id, tags FROM media${whereSql} ORDER BY path LIMIT ?`,
    args: [...args, params.limit + 1],
  };
};

/** Rows for the Files view; `truncated` if more than `limit` matched. */
export const listMediaFiles = async (
  db: D1Database,
  params: FilesParams,
): Promise<{ rows: MediaFileRow[]; truncated: boolean }> => {
  const { sql, args } = filesQuery(params);
  const res = await db
    .prepare(sql)
    .bind(...args)
    .all<MediaFileRow>();
  const all = res.results ?? [];
  return {
    rows: all.slice(0, params.limit),
    truncated: all.length > params.limit,
  };
};

/**
 * Folders that exist without a ready photo in them: those created in the
 * admin (the `folder` table) and those holding an upload that has not
 * completed. Sorted, without duplicates.
 */
export const listFolders = async (db: D1Database): Promise<string[]> => {
  const [folders, pending] = await db.batch<{ path?: string }>([
    db.prepare("SELECT path FROM folder"),
    db.prepare(
      // = status <> 'ready' (the only other status); matches the partial
      // index idx_media_uploading (0007).
      "SELECT path FROM media WHERE status = 'uploading' AND trashed_at IS NULL",
    ),
  ]);
  const paths = new Set<string>();
  for (const r of folders.results ?? []) if (r.path) paths.add(r.path);
  for (const r of pending.results ?? []) {
    if (r.path && dirOf(r.path) !== "/") paths.add(dirOf(r.path));
  }
  return [...paths].sort();
};

// INSERT ... SELECT needs a WHERE before ON CONFLICT (SQLite parsing).
// "Below ?1" is a range on the path indexes (idx_media_path_live, the
// folder's UNIQUE), not a substr() of every path: the paths starting with
// "?1/" are those in ["?1/", "?1" + "0"), "0" being the character after
// "/".
export const CREATE_FOLDER_SQL = `INSERT INTO folder (path) SELECT ?1
  WHERE NOT EXISTS (
    SELECT 1 FROM media WHERE trashed_at IS NULL
      AND path >= ?1 || '/' AND path < ?1 || '0'
  ) AND NOT EXISTS (
    SELECT 1 FROM folder WHERE path >= ?1 || '/' AND path < ?1 || '0'
  )
  ON CONFLICT (path) DO NOTHING`;

/**
 * Create the folder `path` (validated by validateFolderPath). False when
 * it already exists: as a `folder` row, or implicitly because a photo
 * (in any state but trashed; see listFolders) or another created folder
 * lives below it.
 */
export const createFolder = async (
  db: D1Database,
  path: string,
): Promise<boolean> => {
  const res = await db.prepare(CREATE_FOLDER_SQL).bind(path).run();
  return (res.meta.changes ?? 0) > 0;
};

/**
 * The bounds of everything below `folder` ("/" = everywhere) on the path
 * index: the paths in [start, end) are those starting with `folder` + "/"
 * ("0" is the character after "/").
 */
export const folderRange = (folder: string): [string, string] => {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return [prefix, `${prefix.slice(0, -1)}0`];
};

/**
 * The live photos below a folder, subfolders included (?1, ?2 from
 * folderRange), with the columns of the Files view's rows: a range of
 * idx_media_path_live, so it reads the folder's photos and no others.
 * (Left to itself the planner may pick the status or trash index, which
 * reads every photo.)
 */
export const PHOTOS_UNDER_SQL = `SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp, camera_id, tags
  FROM media INDEXED BY idx_media_path_live
  WHERE trashed_at IS NULL AND path >= ?1 AND path < ?2 AND +status = 'ready'
  ORDER BY path LIMIT ?3`;

/** The most photos a selection of folders may stand for at once. */
export const MAX_FOLDER_PHOTOS = 10_000;

/**
 * The folders that are not inside another of them, each once, in the
 * order of their photos' paths ("/a-b/…" before "/a/…"): no photo is then
 * read twice.
 */
export const outermostFolders = (folders: readonly string[]): string[] => {
  const start = (f: string) => folderRange(f)[0];
  const sorted = [...new Set(folders)].sort((a, b) =>
    start(a) < start(b) ? -1 : start(a) > start(b) ? 1 : 0,
  );
  return sorted.filter(
    (f) => !sorted.some((o) => o !== f && (o === "/" || f.startsWith(`${o}/`))),
  );
};

/**
 * Every live photo below `folders` (each with its subfolders), once each,
 * by path. One statement per folder, one after another, each asking for
 * no more than what is left of `limit` (and one more): whatever the
 * folders, at most `limit` + their number of rows are read. `truncated`
 * when there are more than `limit` (the rows are then not all of them).
 */
export const listPhotosUnder = async (
  db: D1Database,
  folders: readonly string[],
  limit = MAX_FOLDER_PHOTOS,
): Promise<{ rows: MediaFileRow[]; truncated: boolean }> => {
  const rows: MediaFileRow[] = [];
  for (const f of outermostFolders(folders)) {
    const res = await db
      .prepare(PHOTOS_UNDER_SQL)
      .bind(...folderRange(f), limit - rows.length + 1)
      .all<MediaFileRow>();
    rows.push(...(res.results ?? []));
    if (rows.length > limit)
      return { rows: rows.slice(0, limit), truncated: true };
  }
  // (Disjoint folders, in path order: the rows are already by path.)
  return { rows, truncated: false };
};
