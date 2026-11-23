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
// or a folder, and uploads, which are private until they complete (their
// file is never a camera picture's, migration 0019). Deleting a photo for
// good does bump: it may have been a camera picture (0019), which goes
// with it.
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
export const contentVersionStatement = (db: D1Database): D1PreparedStatement =>
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
