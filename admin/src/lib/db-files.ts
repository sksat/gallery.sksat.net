// Lean query for the Files view on /media: only what the folder tree and the
// tiles need (id, file, world), for every row matching the filter. Kept apart
// from db.ts's listMedia, which pages full rows by date for the list view.

import type { MediaWorld, Visibility } from "./types";

export type MediaFileRow = { id: number; file: string; world: MediaWorld };

export type FilesParams = {
  world?: MediaWorld;
  visibility?: Visibility;
  q?: string;
  limit: number;
};

/**
 * SQL + bind args. Ordered by file so that, past `limit`, the cut is
 * predictable (the alphabetically last paths), and fetching one more row
 * than `limit` tells the caller the result was truncated.
 */
export const filesQuery = (
  params: FilesParams,
): { sql: string; args: unknown[] } => {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.world) {
    where.push("world = ?");
    args.push(params.world);
  }
  if (params.visibility) {
    where.push("visibility = ?");
    args.push(params.visibility);
  }
  if (params.q) {
    // Same LIKE escaping as listMedia: `%` / `_` in the query are literal.
    const escaped = params.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("file LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  return {
    sql: `SELECT id, file, world FROM media${whereSql} ORDER BY file LIMIT ?`,
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
