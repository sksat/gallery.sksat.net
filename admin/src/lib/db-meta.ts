// Site-wide metadata defaults (`setting`) and tags (`tag`), migration 0005
// (db-meta.spec.ts, on the real schema).

import { siteDefaults, type MetadataLevels } from "./metadata";
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
