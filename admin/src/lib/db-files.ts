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
    sql: `SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp FROM media${whereSql} ORDER BY path LIMIT ?`,
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
