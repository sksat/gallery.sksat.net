// Site-wide metadata defaults (`setting`) and tags (`tag`), migration 0005
// (db-meta.spec.ts, on the real schema).

import {
  storedOverrides,
  withLevels,
  type LevelChange,
} from "./bulk-metadata";
import {
  parseOverrides,
  siteDefaults,
  type MetadataLevels,
} from "./metadata";
import { LIVE_PHOTO } from "./types";

const KEY = "metadata_visibility";

/** The site's metadata visibility defaults. */
export const getSiteDefaults = async (
  db: D1Database,
): Promise<MetadataLevels> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(KEY)
    .first<{ value: string }>();
  return siteDefaults(row?.value);
};

export const setSiteDefaults = async (
  db: D1Database,
  levels: MetadataLevels,
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO setting (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = ?2,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(KEY, JSON.stringify(levels))
    .run();
};

export type TagRow = {
  name: string;
  public: boolean;
  /** Photos (not in the trash, upload completed) that have it. */
  count: number;
};

/**
 * Every tag: those in the `tag` table and those only on photos (private,
 * as they have no row), with how many photos have each, by name.
 */
export const listTags = async (db: D1Database): Promise<TagRow[]> => {
  const res = await db
    .prepare(
      `WITH used AS (
         SELECT j.value AS name, COUNT(DISTINCT media.id) AS n
         FROM media, json_each(media.tags) j
         WHERE ${LIVE_PHOTO} AND json_valid(media.tags) AND j.type = 'text'
         GROUP BY j.value
       ),
       names AS (SELECT name FROM tag UNION SELECT name FROM used)
       SELECT names.name, COALESCE(tag.public, 0) AS public,
              COALESCE(used.n, 0) AS count
       FROM names
       LEFT JOIN tag ON tag.name = names.name
       LEFT JOIN used ON used.name = names.name
       ORDER BY names.name`,
    )
    .all<{ name: string; public: number; count: number }>();
  return (res.results ?? []).map((r) => ({
    name: r.name,
    public: r.public === 1,
    count: r.count,
  }));
};

/** Mark a tag public or private (creating its row if needed). */
export const setTagPublic = async (
  db: D1Database,
  name: string,
  isPublic: boolean,
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO tag (name, public) VALUES (?1, ?2)
       ON CONFLICT (name) DO UPDATE SET public = ?2`,
    )
    .bind(name, isPublic ? 1 : 0)
    .run();
};

/**
 * Give every name in `names` a `tag` row (new ones private). Returns the
 * names that were new, in the given order.
 */
export const ensureTags = async (
  db: D1Database,
  names: readonly string[],
): Promise<string[]> => {
  if (names.length === 0) return [];
  const [existing] = await db.batch<{ name: string }>([
    db
      .prepare(
        "SELECT name FROM tag WHERE name IN (SELECT value FROM json_each(?))",
      )
      .bind(JSON.stringify(names)),
    db
      .prepare(
        `INSERT INTO tag (name) SELECT value FROM json_each(?)
         WHERE true ON CONFLICT (name) DO NOTHING`,
      )
      .bind(JSON.stringify(names)),
  ]);
  const had = new Set((existing.results ?? []).map((r) => r.name));
  return names.filter((n) => !had.has(n));
};

/** Which of `names` are public tags. */
export const publicTags = async (
  db: D1Database,
  names: readonly string[],
): Promise<string[]> => {
  if (names.length === 0) return [];
  const res = await db
    .prepare(
      `SELECT name FROM tag WHERE public = 1
         AND name IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(names))
    .all<{ name: string }>();
  return (res.results ?? []).map((r) => r.name);
};

/** A photo's stored overrides before a bulk change (for its undo). */
export type StoredLevels = { id: number; levels: string | null };

// Sets each listed photo's overrides from one JSON array of [id, value]
// pairs (D1 caps bound parameters at 100 per statement).
const SET_LEVELS_SQL = `UPDATE media SET
   metadata_visibility = (SELECT json_extract(value, '$[1]') FROM json_each(?1)
                          WHERE json_extract(value, '$[0]') = media.id),
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`;

const writeLevels = async (
  db: D1Database,
  rows: readonly StoredLevels[],
): Promise<void> => {
  if (rows.length === 0) return;
  await db
    .prepare(SET_LEVELS_SQL)
    .bind(JSON.stringify(rows.map((r) => [r.id, r.levels])))
    .run();
};

/**
 * Apply `change` to the metadata levels of photos `ids` (bulk-metadata.ts).
 * Returns what each photo that changed had before, for the undo.
 */
export const setMetadataLevels = async (
  db: D1Database,
  ids: readonly number[],
  change: LevelChange,
): Promise<StoredLevels[]> => {
  if (ids.length === 0) return [];
  const res = await db
    .prepare(
      `SELECT id, metadata_visibility FROM media
       WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: number; metadata_visibility: string | null }>();
  const previous: StoredLevels[] = [];
  const next: StoredLevels[] = [];
  for (const r of res.results ?? []) {
    const current = parseOverrides(r.metadata_visibility);
    const levels = storedOverrides(withLevels(current, change));
    // Compared as stored by this module: the edit page may have written
    // the same levels in another key order.
    if (levels === storedOverrides(current)) continue;
    previous.push({ id: r.id, levels: r.metadata_visibility });
    next.push({ id: r.id, levels });
  }
  await writeLevels(db, next);
  return previous;
};

/** Undo of setMetadataLevels: each photo's stored overrides as they were. */
export const restoreMetadataLevels = (
  db: D1Database,
  previous: readonly StoredLevels[],
): Promise<void> => writeLevels(db, previous);
