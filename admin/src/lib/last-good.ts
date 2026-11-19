// Telling the API Worker that what it answers changed
// (last-good.spec.ts, on the real schema).
//
// The API Worker keeps every answer in each data centre's cache under the
// `setting` row `content_version`, and reads D1 again only when that
// changes (workers/api/src/last-good.ts). So every action that changes
// what the public API answers calls contentChanged afterwards, which
// gives the row a new random value (created on first use, no migration).
// Within a minute every data centre answers from D1 again, and stops
// serving the old answers even while D1 fails, so a photo made private,
// moved or with less metadata shown is gone within that minute.
//
// Left out, as they cannot change what the API answers: creating a camera
// or a folder, and uploads, which are private (unless the file is a
// camera picture's: uploadsOverCameraPicture). Deleting a photo for good
// or an incomplete upload does bump: a camera picture with the same file
// becomes servable by path again.
//
// Actions bump whenever they ran, even if nothing changed, so that doing
// an action again after a failed bump bumps again. A change made in one D1
// batch can instead put the bump in that batch (contentVersionStatement,
// e.g. db-photo-bulk.ts): then both commit or neither does, and a failure
// leaves nothing changed.

/** The `setting` key the API Worker watches (CONTENT_VERSION_KEY). */
export const CONTENT_VERSION_KEY = "content_version";

const randomVersion = () =>
  [...crypto.getRandomValues(new Uint8Array(12))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Tries of the version write before giving up. */
const TRIES = 3;

/**
 * The version write as a statement, for an action to put in the same D1
 * batch as its change: both commit, or neither does.
 */
export const contentVersionStatement = (
  db: D1Database,
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO setting (key, value) VALUES (?1, json_quote(?2))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(CONTENT_VERSION_KEY, randomVersion());

/**
 * After an admin change to what the public API answers: a new content
 * version (setting values are JSON). Tried a few times; when every try
 * fails it throws, so the action reports an error and is done again
 * (which bumps again) rather than leaving the change unseen. The API
 * also rebuilds every answer after a day (ENTRY_MAX_AGE_MS), which bounds
 * a lost bump.
 */
export const contentChanged = async (db: D1Database): Promise<void> => {
  for (let i = 1; ; i++) {
    try {
      await contentVersionStatement(db).run();
      return;
    } catch (err) {
      console.error(
        `last-good: bumping the content version failed (${i}/${TRIES}):`,
        err,
      );
      if (i >= TRIES) {
        throw new Error(
          "保存しましたが、公開サイトへの反映に失敗しました。もう一度操作してください",
          { cause: err },
        );
      }
    }
  }
};

/**
 * Whether these uploads have the bucket file of a camera picture: the new
 * row hides that picture from /img (and the upload replaces its object).
 * Otherwise a new, private upload changes nothing the API answers. True
 * when it cannot be told.
 */
export const uploadsOverCameraPicture = async (
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
