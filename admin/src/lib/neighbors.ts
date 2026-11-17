// Previous / next photo for the edit page, in the order of the list it was
// opened from (`?back=`): the list view's date order, or the files view's
// folder sorted by name. Lets a phone step through a filtered list without
// going back to it after every photo.

import { normalizeDir } from "./folders";
import {
  mediaEditHref,
  mediaListHref,
  parseView,
  type MediaView,
} from "./format";
import {
  isVisibility,
  LIVE_PHOTO,
  type MediaWorld,
  type Visibility,
} from "./types";

/** The /media list an edit page was opened from. */
export type ListQuery = {
  view: MediaView;
  dir: string;
  world: MediaWorld | null;
  visibility: Visibility | null;
  q: string;
  page: number;
};

/** Parse a /media list URL (as accepted by safeBackHref). */
export const parseListHref = (href: string): ListQuery => {
  const i = href.indexOf("?");
  const p = new URLSearchParams(i < 0 ? "" : href.slice(i + 1));
  const world = p.get("world");
  const visibility = p.get("visibility");
  const page = Number(p.get("page") ?? "1");
  return {
    view: parseView(p.get("view")),
    dir: normalizeDir(p.get("dir")),
    world: world === "Real" || world === "VRChat" ? world : null,
    visibility: isVisibility(visibility) ? visibility : null,
    q: p.get("q")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
};

/** Same order as listMedia (list view) / filesInDir (files view). */
const LIST_ORDER = "timestamp IS NULL, timestamp DESC, id DESC";
const FILES_ORDER = "path";

/**
 * SQL + args for the neighbours of `id` in `list`: one row with prev_id,
 * next_id, its 1-based position and the total (no row if `id` does not
 * exist). The photo itself always takes part, even when it no longer
 * matches the filter (e.g. just made public in a "private" list), so the
 * user can still go on to the next one; the count then includes it.
 */
export const neighborsQuery = (
  list: ListQuery,
  id: number,
): { sql: string; args: unknown[] } => {
  // Like the lists: completed uploads, not the trash; by path.
  const where: string[] = [LIVE_PHOTO];
  const args: unknown[] = [];
  if (list.world) {
    where.push("world = ?");
    args.push(list.world);
  }
  if (list.visibility) {
    where.push("visibility = ?");
    args.push(list.visibility);
  }
  if (list.q) {
    // Same LIKE escaping as listMedia.
    const escaped = list.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("path LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  if (list.view === "files") {
    // Directly in the folder: the prefix, then no further "/".
    // SQLite counts characters (not UTF-16 units): let it measure.
    const prefix = list.dir === "/" ? "/" : `${list.dir}/`;
    where.push("substr(path, 1, length(?)) = ?");
    where.push("instr(substr(path, length(?) + 1), '/') = 0");
    args.push(prefix, prefix, prefix);
  }
  const whereSql = ` WHERE (${where.join(" AND ")}) OR id = ?`;
  args.push(id);
  const order = list.view === "files" ? FILES_ORDER : LIST_ORDER;
  return {
    sql:
      `SELECT prev_id, next_id, prev_file, next_file, pos, total FROM (SELECT id,` +
      ` LAG(id) OVER w AS prev_id, LEAD(id) OVER w AS next_id,` +
      ` LAG(file) OVER w AS prev_file, LEAD(file) OVER w AS next_file,` +
      ` ROW_NUMBER() OVER w AS pos, COUNT(*) OVER () AS total` +
      ` FROM media${whereSql} WINDOW w AS (ORDER BY ${order})) WHERE id = ?`,
    args: [...args, id],
  };
};

export type NeighborRow = {
  prev_id: number | null;
  next_id: number | null;
  /** Their files (to preload their images); absent in older callers. */
  prev_file?: string | null;
  next_file?: string | null;
  pos: number;
  total: number;
};

export type Neighbors = {
  /** Edit page hrefs (keeping the list in `?back=`), or null at an end. */
  prev: string | null;
  next: string | null;
  /** The neighbours' files, to preload their images. */
  prevFile: string | null;
  nextFile: string | null;
  /** 1-based position in the list, and its length. */
  pos: number;
  total: number;
};

/**
 * Edit page hrefs for a neighbour row. In the list view the neighbour may
 * sit on another page; its `back` points at that page.
 */
export const neighborLinks = (
  list: ListQuery,
  row: NeighborRow,
  pageSize: number,
): Neighbors => {
  const back = (pos: number) =>
    mediaListHref({
      view: list.view,
      dir: list.dir,
      world: list.world,
      visibility: list.visibility,
      q: list.q,
      page: Math.ceil(pos / pageSize),
    });
  return {
    prev:
      row.prev_id === null
        ? null
        : mediaEditHref(row.prev_id, back(row.pos - 1)),
    next:
      row.next_id === null
        ? null
        : mediaEditHref(row.next_id, back(row.pos + 1)),
    prevFile: row.prev_file ?? null,
    nextFile: row.next_file ?? null,
    pos: row.pos,
    total: row.total,
  };
};

export const getNeighbors = async (
  db: D1Database,
  list: ListQuery,
  id: number,
  pageSize: number,
): Promise<Neighbors | null> => {
  const { sql, args } = neighborsQuery(list, id);
  const row = await db
    .prepare(sql)
    .bind(...args)
    .first<NeighborRow>();
  return row ? neighborLinks(list, row, pageSize) : null;
};
