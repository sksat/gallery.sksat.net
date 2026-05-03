import type {
  MediaInfoJSON,
  MediaPatch,
  MediaRow,
  MediaWorld,
} from "./types";

type RawRow = {
  id: number;
  file: string;
  world: string;
  timestamp: string | null;
  camera_make: string | null;
  camera_model: string | null;
  tags: string;
  updated_at: string;
};

const isWorld = (v: string): v is MediaWorld =>
  v === "Real" || v === "VRChat";

const parseTags = (raw: string): string[] => {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((t) => typeof t === "string")) {
    throw new Error(`tags column is not a JSON string array: ${raw}`);
  }
  return parsed;
};

export const rowToMedia = (raw: RawRow): MediaRow => {
  if (!isWorld(raw.world)) {
    throw new Error(`unknown world value in DB: ${raw.world}`);
  }
  return {
    id: raw.id,
    file: raw.file,
    world: raw.world,
    timestamp: raw.timestamp,
    camera_make: raw.camera_make,
    camera_model: raw.camera_model,
    tags: parseTags(raw.tags),
    updated_at: raw.updated_at,
  };
};

export const rowToMediaJson = (row: MediaRow): MediaInfoJSON => ({
  file: row.file,
  world: row.world,
  timestamp: row.timestamp,
  camera:
    row.camera_make && row.camera_model
      ? { make: row.camera_make, model: row.camera_model }
      : null,
  tags: row.tags,
});

export type ListParams = {
  world?: MediaWorld;
  q?: string;
  limit: number;
  offset: number;
};

export type ListResult = {
  rows: MediaRow[];
  total: number;
};

export const listMedia = async (
  db: D1Database,
  params: ListParams,
): Promise<ListResult> => {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.world) {
    where.push("world = ?");
    args.push(params.world);
  }
  if (params.q) {
    where.push("file LIKE ?");
    args.push(`%${params.q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rowsStmt = db
    .prepare(
      `SELECT * FROM media ${whereSql} ORDER BY timestamp IS NULL, timestamp DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...args, params.limit, params.offset);
  const countStmt = db
    .prepare(`SELECT COUNT(*) AS c FROM media ${whereSql}`)
    .bind(...args);

  const [rowsRes, countRes] = await Promise.all([
    rowsStmt.all<RawRow>(),
    countStmt.first<{ c: number }>(),
  ]);

  return {
    rows: (rowsRes.results ?? []).map(rowToMedia),
    total: countRes?.c ?? 0,
  };
};

export const getMedia = async (
  db: D1Database,
  id: number,
): Promise<MediaRow | null> => {
  const raw = await db
    .prepare("SELECT * FROM media WHERE id = ?")
    .bind(id)
    .first<RawRow>();
  return raw ? rowToMedia(raw) : null;
};

export const updateMedia = async (
  db: D1Database,
  id: number,
  patch: MediaPatch,
): Promise<MediaRow | null> => {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.world !== undefined) {
    sets.push("world = ?");
    args.push(patch.world);
  }
  if (patch.camera_make !== undefined) {
    sets.push("camera_make = ?");
    args.push(patch.camera_make);
  }
  if (patch.camera_model !== undefined) {
    sets.push("camera_model = ?");
    args.push(patch.camera_model);
  }
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    args.push(JSON.stringify(patch.tags));
  }
  if (sets.length === 0) return getMedia(db, id);

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  await db
    .prepare(`UPDATE media SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...args, id)
    .run();
  return getMedia(db, id);
};

export const allMediaForExport = async (
  db: D1Database,
): Promise<MediaInfoJSON[]> => {
  const res = await db
    .prepare(
      "SELECT * FROM media ORDER BY timestamp IS NULL, timestamp DESC, id DESC",
    )
    .all<RawRow>();
  return (res.results ?? []).map((r) => rowToMediaJson(rowToMedia(r)));
};
