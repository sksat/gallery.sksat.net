// The `platform` table (migration 0014) for /platform/ and every platform
// select (db-platform.spec.ts, on the real schema). The key never changes;
// the name and kind change what the public API answers (its platform name,
// and whether a location is shown), so those writes bump the content
// version in the same batch. Adding, reordering and deleting do not: the
// API shows no order, and only an unused platform is added or deleted.
import { getUploadRules } from "./db-upload-rules";
import { contentVersionStatement } from "./last-good";
import {
  isBuiltinPlatform,
  isPlatformKind,
  platformKeyFor,
  type Platform,
  type PlatformKind,
} from "./platform";
import { LIVE_PHOTO } from "./types";

type PlatformDbRow = {
  key: string;
  name: string;
  kind: string;
  position: number;
};

/** A row as stored, for putting a deleted platform back. */
export type PlatformRow = Platform & { position: number };

export type PlatformWithCount = PlatformRow & {
  /** Listed photos (not in the trash, upload finished). */
  count: number;
  /** Any row at all, the trash included: it can be deleted only at 0. */
  used: number;
};

const toPlatform = (r: PlatformDbRow): PlatformRow => ({
  key: r.key,
  name: r.name,
  // The table's CHECK allows nothing else.
  kind: isPlatformKind(r.kind) ? r.kind : "real",
  position: r.position,
});

const ORDER = "ORDER BY position, key";

/** Every platform, in the admin's order. */
export const listPlatforms = async (db: D1Database): Promise<Platform[]> => {
  const { results } = await db
    .prepare(`SELECT key, name, kind, position FROM platform ${ORDER}`)
    .all<PlatformDbRow>();
  return (results ?? []).map(({ key, name, kind }) => ({
    key,
    name,
    kind: isPlatformKind(kind) ? kind : "real",
  }));
};

/** Whether a platform with this key exists (one primary-key read). */
export const platformExists = async (
  db: D1Database,
  key: string,
): Promise<boolean> =>
  (await db
    .prepare("SELECT 1 AS found FROM platform WHERE key = ?")
    .bind(key)
    .first()) !== null;

/**
 * Every platform with its photo counts (one pass over `media`; the page
 * is rarely opened).
 */
export const listPlatformsWithCounts = async (
  db: D1Database,
): Promise<PlatformWithCount[]> => {
  const { results } = await db
    .prepare(
      `SELECT p.key, p.name, p.kind, p.position,
              COALESCE(c.count, 0) AS count, COALESCE(c.used, 0) AS used
       FROM platform p LEFT JOIN (
         SELECT platform, SUM(${LIVE_PHOTO}) AS count, COUNT(*) AS used
         FROM media GROUP BY platform
       ) c ON c.platform = p.key
       ORDER BY p.position, p.key`,
    )
    .all<PlatformDbRow & { count: number; used: number }>();
  return (results ?? []).map((r) => ({
    ...toPlatform(r),
    count: r.count,
    used: r.used,
  }));
};

export type PlatformWriteResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

const isNameTaken = (err: unknown) =>
  err instanceof Error &&
  /UNIQUE constraint failed: platform\.name/.test(err.message);

const isKeyTaken = (err: unknown) =>
  err instanceof Error &&
  /UNIQUE constraint failed: platform\.key/.test(err.message);

const NAME_TAKEN = "その名前のプラットフォームはもうあります";

/** Add a platform at the end; its key comes from its name. */
export const addPlatform = async (
  db: D1Database,
  name: string,
  kind: PlatformKind,
): Promise<PlatformWriteResult<PlatformRow>> => {
  const { results } = await db
    .prepare("SELECT key FROM platform")
    .all<{ key: string }>();
  const key = platformKeyFor(
    name,
    (results ?? []).map((r) => r.key),
  );
  try {
    const row = await db
      .prepare(
        `INSERT INTO platform (key, name, kind, position)
         VALUES (?1, ?2, ?3,
                 (SELECT COALESCE(MAX(position), -1) + 1 FROM platform))
         RETURNING key, name, kind, position`,
      )
      .bind(key, name, kind)
      .first<PlatformDbRow>();
    if (!row) return { ok: false, error: "追加できませんでした" };
    return { ok: true, value: toPlatform(row) };
  } catch (err) {
    if (isNameTaken(err)) return { ok: false, error: NAME_TAKEN };
    // Another add took the same key in between: try again.
    if (isKeyTaken(err)) {
      return {
        ok: false,
        error: "追加できませんでした。もう一度追加してください",
      };
    }
    throw err;
  }
};

/**
 * Change a platform's name and kind; returns what it was before (for
 * undo), or an error when there is no such platform or the name is taken.
 */
export const updatePlatform = async (
  db: D1Database,
  key: string,
  next: { name: string; kind: PlatformKind },
): Promise<PlatformWriteResult<Platform>> => {
  try {
    const [before] = await db.batch<PlatformDbRow>([
      db
        .prepare("SELECT key, name, kind, position FROM platform WHERE key = ?")
        .bind(key),
      db
        .prepare("UPDATE platform SET name = ?2, kind = ?3 WHERE key = ?1")
        .bind(key, next.name, next.kind),
      contentVersionStatement(db),
    ]);
    const row = (before.results ?? [])[0];
    if (!row) return { ok: false, error: "そのプラットフォームはありません" };
    const { position: _, ...prev } = toPlatform(row);
    return { ok: true, value: prev };
  } catch (err) {
    if (isNameTaken(err)) return { ok: false, error: NAME_TAKEN };
    throw err;
  }
};

/**
 * Move a platform one place up (-1) or down (+1) in the order; the
 * positions are written again as 0, 1, 2, …. False when it cannot move.
 */
export const movePlatform = async (
  db: D1Database,
  key: string,
  step: -1 | 1,
): Promise<boolean> => {
  const { results } = await db
    .prepare(`SELECT key FROM platform ${ORDER}`)
    .all<{ key: string }>();
  const keys = (results ?? []).map((r) => r.key);
  const i = keys.indexOf(key);
  const j = i + step;
  if (i < 0 || j < 0 || j >= keys.length) return false;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  await db
    .prepare(
      `UPDATE platform SET position = (
         SELECT CAST(j.key AS INTEGER) FROM json_each(?1) j
         WHERE j.value = platform.key)
       WHERE key IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(keys))
    .run();
  return true;
};

/**
 * Delete a platform no photo uses (the trash and unfinished uploads
 * included; media.platform's REFERENCES refuses it too). Returns the row,
 * for undo.
 */
export const deletePlatform = async (
  db: D1Database,
  key: string,
): Promise<PlatformWriteResult<PlatformRow>> => {
  if (isBuiltinPlatform(key)) {
    return { ok: false, error: "このプラットフォームは削除できません" };
  }
  // An upload rule that sets it would make uploads fail.
  if ((await getUploadRules(db)).some((r) => r.actions.platform === key)) {
    return {
      ok: false,
      error: "アップロードのルールが使っているプラットフォームは削除できません",
    };
  }
  const row = await db
    .prepare(
      `DELETE FROM platform WHERE key = ?1
         AND NOT EXISTS (SELECT 1 FROM media WHERE platform = ?1)
       RETURNING key, name, kind, position`,
    )
    .bind(key)
    .first<PlatformDbRow>();
  if (row) return { ok: true, value: toPlatform(row) };
  return {
    ok: false,
    error: (await platformExists(db, key))
      ? "写真があるプラットフォームは削除できません"
      : "そのプラットフォームはありません",
  };
};

/** Undo of deletePlatform: the same row again. */
export const restorePlatform = async (
  db: D1Database,
  row: PlatformRow,
): Promise<PlatformWriteResult<PlatformRow>> => {
  try {
    await db
      .prepare(
        "INSERT INTO platform (key, name, kind, position) VALUES (?, ?, ?, ?)",
      )
      .bind(row.key, row.name, row.kind, row.position)
      .run();
    return { ok: true, value: row };
  } catch (err) {
    if (isNameTaken(err)) return { ok: false, error: NAME_TAKEN };
    // A platform added since took the key back.
    if (isKeyTaken(err)) {
      return {
        ok: false,
        error: "同じキーのプラットフォームが追加されています",
      };
    }
    throw err;
  }
};
