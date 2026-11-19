// D1 side of the Files view's operations (db-ops.spec.ts, on the real
// schema): move / rename (display paths only, file-ops.ts plans them),
// trash, restore and deleting for good. Each change is one D1 batch (a
// transaction).

import { numberedPaths } from "./db-upload";
import { planMoves, type Move, type Plan, type Tree } from "./file-ops";
import { dirOf } from "./folders";
import {
  photoObjects,
  UnsupportedStorageError,
  type FileObject,
  type FileStorage,
} from "./media-file";
import type { CopiesBucket } from "@shared/resized/resized";
import { removeResized } from "./resized";
import type { MediaPlatform } from "./types";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Photos not in the trash (any upload state) and the folder rows. */
export const loadTree = async (db: D1Database): Promise<Tree> => {
  const [photos, folders] = await db.batch<{ id?: number; path: string }>([
    db.prepare("SELECT id, path FROM media WHERE trashed_at IS NULL"),
    db.prepare("SELECT path FROM folder"),
  ]);
  return {
    photos: (photos.results ?? []).map((r) => ({
      id: r.id as number,
      path: r.path,
    })),
    folders: (folders.results ?? []).map((r) => r.path),
  };
};

export type MoveOutcome =
  { ok: true; plan: Plan } | { ok: false; error: string };

const isUniqueError = (err: unknown) =>
  err instanceof Error && /UNIQUE constraint failed/.test(err.message);

/** Plan `moves` against the current tree and apply it in one batch. */
export const moveItems = async (
  db: D1Database,
  moves: readonly Move[],
): Promise<MoveOutcome> => {
  const planned = planMoves(await loadTree(db), moves);
  if (!planned.ok) return planned;
  const { plan } = planned;
  if (plan.photos.length === 0 && plan.folders.length === 0) {
    return { ok: true, plan };
  }
  const statements: D1PreparedStatement[] = [];
  if (plan.photos.length > 0) {
    // One statement for every photo: D1 caps bound parameters at 100.
    // The unique index is checked row by row, so a swap or a chain (a takes
    // b's old path while b moves on) would collide halfway: first every
    // moved photo goes to a placeholder path ("/.tmp/<id>"; folder names
    // cannot start with "."), then to its new one.
    const ids = JSON.stringify(plan.photos.map((p) => p.id));
    statements.push(
      db
        .prepare(
          `UPDATE media SET path = '/.tmp/' || id
           WHERE trashed_at IS NULL AND id IN (SELECT value FROM json_each(?1))`,
        )
        .bind(ids),
      db
        .prepare(
          `UPDATE media SET
             path = (SELECT json_extract(j.value, '$.to') FROM json_each(?1) j
                     WHERE json_extract(j.value, '$.id') = media.id),
             updated_at = ${NOW}
           WHERE trashed_at IS NULL
             AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
        )
        .bind(JSON.stringify(plan.photos.map(({ id, to }) => ({ id, to })))),
    );
  }
  for (const f of plan.folders) {
    statements.push(
      db
        .prepare(
          `UPDATE folder SET path = ?2 || substr(path, length(?1) + 1)
           WHERE path = ?1 OR substr(path, 1, length(?1) + 1) = ?1 || '/'`,
        )
        .bind(f.from, f.to),
    );
  }
  // Folders photos left stay, as in any file manager.
  for (const dir of plan.keep) {
    statements.push(
      db
        .prepare(
          "INSERT INTO folder (path) VALUES (?) ON CONFLICT (path) DO NOTHING",
        )
        .bind(dir),
    );
  }
  try {
    await db.batch(statements);
  } catch (err) {
    // Someone else took a name meanwhile (the indexes are the backstop).
    if (isUniqueError(err)) {
      return {
        ok: false,
        error: "移動先の名前が使われています。もう一度試してください",
      };
    }
    throw err;
  }
  return { ok: true, plan };
};

export type TrashResult = {
  /** Photos now in the trash (for undo). */
  ids: number[];
  /** Folder rows removed (for undo). */
  folders: string[];
};

/**
 * Put photos and folders (with everything below them) in the trash. Empty
 * folders just go. Already trashed photos are left alone.
 */
export const trashItems = async (
  db: D1Database,
  items: { photos: readonly number[]; folders: readonly string[] },
): Promise<TrashResult> => {
  const folders = JSON.stringify(items.folders);
  const inFolders = `EXISTS (SELECT 1 FROM json_each(?2) f
      WHERE substr(media.path, 1, length(f.value) + 1) = f.value || '/')`;
  // One batch, choosing and changing in the same statements (RETURNING),
  // so a photo moved in or out meanwhile is not missed or wrongly taken.
  // Only finished uploads: an `uploading` row stays listed as incomplete
  // in its folder (its PUT may still be running, and it has its own 削除).
  const [ids, rows] = await db.batch<{ id?: number; path?: string }>([
    db
      .prepare(
        `UPDATE media SET trashed_at = ${NOW}, updated_at = ${NOW}
         WHERE trashed_at IS NULL AND status = 'ready'
           AND (id IN (SELECT value FROM json_each(?1)) OR ${inFolders})
         RETURNING id`,
      )
      .bind(JSON.stringify(items.photos), folders),
    db
      .prepare(
        `DELETE FROM folder WHERE EXISTS (SELECT 1 FROM json_each(?1) f
           WHERE folder.path = f.value
              OR substr(folder.path, 1, length(f.value) + 1) = f.value || '/')
         RETURNING path`,
      )
      .bind(folders),
  ]);
  const trashed = (ids.results ?? [])
    .map((r) => r.id as number)
    .sort((a, b) => a - b);
  const removed = (rows.results ?? []).map((r) => r.path as string).sort();
  return { ids: trashed, folders: removed };
};

export type RestoreResult = {
  /** Where each photo went back (a numbered name if its place was taken). */
  restored: { id: number; path: string }[];
};

/**
 * Take photos out of the trash, each to its old place, or the first free
 * numbered name there ("a-1.png") when another photo has taken it.
 * `folders` (an undone folder trash) are created again.
 */
export const restoreItems = async (
  db: D1Database,
  ids: readonly number[],
  folders: readonly string[] = [],
): Promise<RestoreResult> => {
  const [rows, live] = await db.batch<{ id?: number; path: string }>([
    db
      .prepare(
        `SELECT id, path FROM media WHERE trashed_at IS NOT NULL
           AND id IN (SELECT value FROM json_each(?1)) ORDER BY id`,
      )
      .bind(JSON.stringify(ids)),
    db.prepare(
      "SELECT path FROM media WHERE trashed_at IS NULL UNION SELECT path FROM folder",
    ),
  ]);
  // Taken: photos, and folders (rows, and the folders of photos).
  const taken = new Set<string>();
  for (const { path } of live.results ?? []) {
    taken.add(path);
    for (let d = dirOf(path); d !== "/"; d = dirOf(d)) taken.add(d);
  }
  const restored: RestoreResult["restored"] = [];
  const skipped: number[] = [];
  for (const r of rows.results ?? []) {
    const path = numberedPaths(r.path).find((p) => !taken.has(p));
    if (path === undefined) {
      skipped.push(r.id as number);
      continue;
    }
    taken.add(path);
    restored.push({ id: r.id as number, path });
  }
  if (skipped.length > 0) {
    throw new RestoreError(
      `${skipped.length} 件は戻す先の名前がすべて使われています。先に移動か名前の変更をしてください`,
    );
  }
  try {
    await runRestore(db, restored, folders);
  } catch (err) {
    if (isUniqueError(err)) {
      throw new RestoreError(
        "戻す先の名前が使われました。もう一度試してください",
      );
    }
    throw err;
  }
  return { restored };
};

/** A restore that could not be done, with a message for the user. */
export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreError";
  }
}

const runRestore = async (
  db: D1Database,
  restored: RestoreResult["restored"],
  folders: readonly string[],
) => {
  await db.batch([
    db
      .prepare(
        `UPDATE media SET trashed_at = NULL, updated_at = ${NOW},
           path = (SELECT json_extract(j.value, '$.path') FROM json_each(?1) j
                   WHERE json_extract(j.value, '$.id') = media.id)
         WHERE trashed_at IS NOT NULL
           AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
      )
      .bind(JSON.stringify(restored)),
    db
      .prepare(
        `INSERT INTO folder (path) SELECT value FROM json_each(?1)
         WHERE true ON CONFLICT (path) DO NOTHING`,
      )
      .bind(JSON.stringify(folders)),
  ]);
};

export type TrashedPhoto = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  size: number | null;
  trashed_at: string;
  kind: "image" | "video";
  duration_ms: number | null;
};

/** The trash, most recently trashed first, and its total size. */
export const listTrash = async (
  db: D1Database,
): Promise<{ rows: TrashedPhoto[]; bytes: number }> => {
  const res = await db
    .prepare(
      `SELECT id, file, path, platform, size, trashed_at, kind, duration_ms FROM media
       WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC, id DESC`,
    )
    .all<TrashedPhoto>();
  const rows = res.results ?? [];
  return { rows, bytes: rows.reduce((n, r) => n + (r.size ?? 0), 0) };
};

export type PurgeResult = {
  deleted: number[];
  failed: { id: number; error: string }[];
};

/**
 * Delete trashed photos for good: first every version of each of the
 * photo's files (media_file, 0013: the original, retouched versions and
 * copies; `removeObject`, b2-delete.ts), then the row, which takes its
 * media_file rows with it. Retry-safe: an object already gone is skipped
 * next time, and a failure leaves the row (and every file row) for a
 * retry. Only trashed rows are touched; a file that is also a camera
 * picture keeps its object. The photo's resized copies (0018) go from
 * `copies` (the MEDIA_CACHE bucket) first; a photo that has some stays whole
 * when there is no such bucket.
 */
export const purgeItems = async (
  db: D1Database,
  ids: readonly number[],
  removeObject: (object: FileObject) => Promise<void>,
  /** Where objects can be deleted from (R2 has no binding yet). */
  storages: readonly FileStorage[] = ["b2"],
  copies: CopiesBucket | null = null,
): Promise<PurgeResult> => {
  const rows =
    (
      await db
        .prepare(
          `SELECT id, resized_at FROM media
           WHERE trashed_at IS NOT NULL AND status = 'ready'
             AND id IN (SELECT value FROM json_each(?1))
           ORDER BY id`,
        )
        .bind(JSON.stringify(ids))
        .all<{ id: number; resized_at: string | null }>()
    ).results ?? [];
  const objects = await photoObjects(
    db,
    rows.map((r) => r.id),
  );
  const result: PurgeResult = { deleted: [], failed: [] };
  for (const r of rows) {
    try {
      const mine = objects.filter((o) => o.mediaId === r.id && !o.shared);
      // Nothing is deleted from a photo some of whose objects cannot be:
      // it stays in the trash whole, and can still be restored.
      const stuck = mine.find((o) => !storages.includes(o.storage));
      if (stuck) throw new UnsupportedStorageError(stuck.storage);
      if (copies) await removeResized(db, copies, r.id);
      else if (r.resized_at !== null) {
        // It may have copies (made, or being made) we cannot remove.
        throw new Error("縮小版の置き場が設定されていないので削除できません");
      }
      for (const o of mine) await removeObject(o);
      await db
        .prepare("DELETE FROM media WHERE id = ? AND trashed_at IS NOT NULL")
        .bind(r.id)
        .run();
      result.deleted.push(r.id);
    } catch (err) {
      result.failed.push({
        id: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
};
