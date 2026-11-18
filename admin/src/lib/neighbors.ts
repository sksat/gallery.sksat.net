// Previous / next photo for the edit page, in the order of the list it was
// opened from (`?back=`): the list view's date order, or the files view's
// folder sorted by name. Lets a phone step through a filtered list without
// going back to it after every photo.

import { normalizeDir } from "./folders";
import {
  mediaEditHref,
  mediaListHref,
  parseView,
  platformParam,
  type MediaView,
} from "./format";
import {
  isVisibility,
  LIVE_PHOTO,
  type MediaPlatform,
  type Visibility,
} from "./types";

/** The /media list an edit page was opened from. */
export type ListQuery = {
  view: MediaView;
  dir: string;
  platform: MediaPlatform | null;
  visibility: Visibility | null;
  q: string;
  page: number;
};

/** Parse a /media list URL (as accepted by safeBackHref). */
export const parseListHref = (href: string): ListQuery => {
  const i = href.indexOf("?");
  const p = new URLSearchParams(i < 0 ? "" : href.slice(i + 1));
  const visibility = p.get("visibility");
  const page = Number(p.get("page") ?? "1");
  return {
    view: parseView(p.get("view")),
    dir: normalizeDir(p.get("dir")),
    platform: platformParam(p),
    visibility: isVisibility(visibility) ? visibility : null,
    q: p.get("q")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
};

/** The photo the edit page shows: where it sorts in either list. */
export type NeighborAnchor = {
  id: number;
  path: string;
  timestamp: string | null;
};

type Sql = { sql: string; args: unknown[] };

/**
 * The list's filter (without the photo itself): the WHERE terms of
 * listMedia (list view) or of the folder's photos (files view). The folder
 * is a range of `path` (prefix .. prefix with its final "/" bumped to "0",
 * the next byte), so the path index finds it; only paths directly in it
 * (no further "/") count.
 */
const listFilter = (list: ListQuery): Sql => {
  // Like the lists: completed uploads, not the trash.
  const where: string[] = [LIVE_PHOTO];
  const args: unknown[] = [];
  if (list.platform) {
    where.push("platform = ?");
    args.push(list.platform);
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
    const prefix = list.dir === "/" ? "/" : `${list.dir}/`;
    // SQLite counts characters (not UTF-16 units): let it measure.
    where.push(
      "path >= ? AND path < ?",
      "instr(substr(path, length(?) + 1), '/') = 0",
    );
    args.push(prefix, `${prefix.slice(0, -1)}0`, prefix);
  }
  return { sql: where.join(" AND "), args };
};

const select = (filter: Sql, cond: Sql, order: string): Sql => ({
  sql: `SELECT id, file FROM media WHERE ${filter.sql} AND ${cond.sql} ORDER BY ${order} LIMIT 1`,
  args: [...filter.args, ...cond.args],
});

/**
 * The first row of `a`, else of `b`. SQLite runs a UNION ALL's parts in
 * order and stops at the LIMIT, so `b` is not run when `a` has a row (the
 * order is SQLite's behaviour, not SQL's; neighbors.spec.ts checks it).
 */
const firstOf = (a: Sql, b: Sql): Sql => ({
  sql: `SELECT * FROM (${a.sql}) UNION ALL SELECT * FROM (${b.sql}) LIMIT 1`,
  args: [...a.args, ...b.args],
});

type Part = { cond: Sql; order: string };
const part = (sql: string, args: unknown[], order: string): Part => ({
  cond: { sql, args },
  order,
});

/**
 * The statements for the neighbours of `anchor` in `list`: the previous
 * photo, the next one (each `id, file`; no row at an end) and one row with
 * how many photos of the list come `before` and `after` it. Keyset lookups
 * on the list's order (listMedia: timestamp DESC, id DESC, undated last;
 * files: path), so the neighbours read a few index entries instead of
 * sorting the whole list, and the two counts together read the list once
 * from an index (migration 0007).
 *
 * The photo itself always takes part, even when it no longer matches the
 * filter (e.g. just made public in a "private" list), so the user can still
 * go on to the next one: its position is before + 1 and the total
 * before + after + 1.
 */
export const neighborsStatements = (
  list: ListQuery,
  anchor: NeighborAnchor,
): { prev: Sql; next: Sql; counts: Sql } => {
  const filter = listFilter(list);
  // Each side of the anchor as disjoint parts, nearest first, each with
  // the order that walks away from the anchor.
  let before: Part[];
  let after: Part[];
  if (list.view === "files") {
    before = [part("path < ?", [anchor.path], "path DESC")];
    after = [part("path > ?", [anchor.path], "path")];
  } else if (anchor.timestamp !== null) {
    // Dated: newer (or the same time and a larger id) comes first; the
    // undated come last.
    const key = [anchor.timestamp, anchor.id];
    before = [part("(timestamp, id) > (?, ?)", key, "timestamp, id")];
    after = [
      part("(timestamp, id) < (?, ?)", key, "timestamp DESC, id DESC"),
      part("timestamp IS NULL", [], "id DESC"),
    ];
  } else {
    // Undated: after every dated photo, by id desc.
    before = [
      part("timestamp IS NULL AND id > ?", [anchor.id], "id"),
      part("timestamp IS NOT NULL", [], "timestamp, id"),
    ];
    after = [part("timestamp IS NULL AND id < ?", [anchor.id], "id DESC")];
  }
  const nearest = (parts: Part[]): Sql =>
    parts
      .map((p) => select(filter, p.cond, p.order))
      .reduce((a, b) => firstOf(a, b));
  const count = (parts: Part[]): Sql => ({
    sql: parts
      .map(
        (p) =>
          `(SELECT COUNT(*) FROM media WHERE ${filter.sql} AND ${p.cond.sql})`,
      )
      .join(" + "),
    args: parts.flatMap((p) => [...filter.args, ...p.cond.args]),
  });
  const b = count(before);
  const a = count(after);
  return {
    prev: nearest(before),
    next: nearest(after),
    counts: {
      sql: `SELECT ${b.sql} AS before, ${a.sql} AS after`,
      args: [...b.args, ...a.args],
    },
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
      platform: list.platform,
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

type IdFile = { id: number; file: string };

/** Previous / next of `anchor` in `list`, in one D1 round trip. */
export const queryNeighbors = async (
  db: D1Database,
  list: ListQuery,
  anchor: NeighborAnchor,
): Promise<NeighborRow> => {
  const { prev, next, counts } = neighborsStatements(list, anchor);
  const stmt = ({ sql, args }: Sql) => db.prepare(sql).bind(...args);
  type Counts = { before: number; after: number };
  const [p, n, c] = await db.batch<IdFile | Counts>([
    stmt(prev),
    stmt(next),
    stmt(counts),
  ]);
  const prevRow = p.results[0] as IdFile | undefined;
  const nextRow = n.results[0] as IdFile | undefined;
  const { before, after } = c.results[0] as Counts;
  return {
    prev_id: prevRow?.id ?? null,
    next_id: nextRow?.id ?? null,
    prev_file: prevRow?.file ?? null,
    next_file: nextRow?.file ?? null,
    pos: before + 1,
    total: before + after + 1,
  };
};

/** Previous / next of `anchor` (a photo that exists) in `list`, as links. */
export const getNeighbors = async (
  db: D1Database,
  list: ListQuery,
  anchor: NeighborAnchor,
  pageSize: number,
): Promise<Neighbors> =>
  neighborLinks(list, await queryNeighbors(db, list, anchor), pageSize);
