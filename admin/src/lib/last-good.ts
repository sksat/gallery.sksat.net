// Keeping the API Worker's last-good snapshot in step with admin changes
// (last-good.spec.ts, on the real schema).
//
// The API Worker keeps everything it answers as one snapshot in the
// `LAST_GOOD` KV namespace and serves it while D1 fails
// (workers/api/src/last-good-store.ts). It rebuilds the snapshot when the
// `setting` row `content_version` changes, so every action that changes
// what the public API answers calls contentChanged afterwards:
// - when the change hides something (`hide`: a photo less visible,
//   moved, renamed, trashed, with less metadata shown, a tag or camera
//   picture withdrawn or re-captioned, the site defaults changed), it
//   first deletes the snapshot (one KV delete), so a stale one cannot
//   bring that back during a D1 outage before the rebuild. If D1 is down
//   at that moment, the admin cannot write either;
// - then it rewrites `content_version` (a new random value; the row is
//   created on first use, no migration), and the API's cron rebuilds the
//   snapshot within a minute.
//
// Left out, as they cannot change what the API answers: creating a camera
// or a folder, deleting a trashed photo for good (it left the snapshot
// when it was trashed), and uploads, which are private (unless the file
// is a camera picture's: uploadsHideCameraPicture). The metadata backfill
// only fills empty columns, so it bumps the version without deleting.
//
// Never fails an action: errors are logged. Without the binding
// (previews, `pnpm dev`) only the version is written.

import type { Visibility } from "./types";

/** The part of a KV namespace used here. */
export type LastGoodKV = { delete(key: string): Promise<void> };

type Platform = { env?: Record<string, unknown> } | undefined;

/** The `LAST_GOOD` binding, or null when it is not bound. */
export const getLastGoodKV = (platform: Platform): LastGoodKV | null =>
  (platform?.env?.LAST_GOOD as LastGoodKV | undefined) ?? null;

/** The snapshot's KV key: the API Worker's SNAPSHOT_KEY. */
export const SNAPSHOT_KEY = "snapshot";

/** The `setting` key the API Worker watches (CONTENT_VERSION_KEY). */
export const CONTENT_VERSION_KEY = "content_version";

const randomVersion = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Give `content_version` a new value (setting values are JSON). */
export const bumpContentVersion = async (db: D1Database): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO setting (key, value) VALUES (?1, json_quote(?2))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(CONTENT_VERSION_KEY, randomVersion())
    .run();
};

/**
 * After an admin change to what the public API answers: a new content
 * version, and the snapshot deleted when `hide`. Never rejects.
 */
export const contentChanged = async (
  platform: Platform,
  db: D1Database,
  { hide = false }: { hide?: boolean } = {},
): Promise<void> => {
  // Delete first, then bump: a rebuild between the two still sees the old
  // version and is replaced on the next run; the other order could delete
  // a snapshot already rebuilt for the new version, leaving none.
  const kv = getLastGoodKV(platform);
  if (hide && kv) {
    await kv
      .delete(SNAPSHOT_KEY)
      .catch((err) =>
        console.error("last-good: deleting the snapshot failed:", err),
      );
  }
  try {
    await bumpContentVersion(db);
  } catch (err) {
    console.error("last-good: bumping the content version failed:", err);
  }
};

const RANK: Record<Visibility, number> = { private: 0, unlisted: 1, public: 2 };

/** Whether any change makes a photo less visible than it was. */
export const lowersVisibility = (
  changes: readonly { from: Visibility; to: Visibility }[],
): boolean => changes.some((c) => RANK[c.to] < RANK[c.from]);

/**
 * Whether any of these photos is one the API may show (finished, public
 * or unlisted; the trash aside, so it also works right after trashing).
 * A change to one of them can hide something; to private ones, not.
 */
export const anyShown = async (
  db: D1Database,
  ids: readonly number[],
): Promise<boolean> => {
  if (ids.length === 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM media WHERE status = 'ready'
         AND visibility IN ('public', 'unlisted')
         AND id IN (SELECT value FROM json_each(?1)) LIMIT 1`,
    )
    .bind(JSON.stringify(ids))
    .first<{ found: number }>();
  return row !== null;
};

/**
 * Whether these uploads have the bucket file of a camera picture: the new
 * row hides that picture from /img (and the upload replaces its object).
 * Otherwise a new, private upload changes nothing the API answers.
 */
export const uploadsHideCameraPicture = async (
  db: D1Database,
  ids: readonly number[],
): Promise<boolean> => {
  if (ids.length === 0) return false;
  try {
    const row = await db
      .prepare(
        `SELECT 1 AS found FROM media m
         WHERE m.id IN (SELECT value FROM json_each(?1))
           AND EXISTS (SELECT 1 FROM camera_image c WHERE c.file = m.file)
         LIMIT 1`,
      )
      .bind(JSON.stringify(ids))
      .first<{ found: number }>();
    return row !== null;
  } catch (err) {
    console.error("last-good: checking camera pictures failed:", err);
    return true;
  }
};

/**
 * Whether a move (moveItems' plan) moved a photo the API may show: its old
 * display path no longer serves it on /img.
 */
export const movedShown = (
  db: D1Database,
  plan: { photos: readonly { id: number }[] },
): Promise<boolean> =>
  safeAnyShown(
    db,
    plan.photos.map((p) => p.id),
  );

/** `anyShown`, but true (hide, to be safe) instead of throwing. */
export const safeAnyShown = async (
  db: D1Database,
  ids: readonly number[],
): Promise<boolean> => {
  try {
    return await anyShown(db, ids);
  } catch (err) {
    console.error("last-good: reading visibility failed, hiding:", err);
    return true;
  }
};
