// Tags of a camera (migration 0011): edited on the camera's page; the
// ones marked 「写真にも付ける」 (propagate) count as tags of every photo
// taken with it, worked out when read (effectiveTags), never copied into
// media.tags. db-camera-tag.spec.ts runs these on the real schema.

import { effectiveTags } from "@shared/tag-field/tag-field";
import { contentVersionStatement } from "./last-good";

// Each write here (and the undo, which is addCameraTag again) bumps the
// API's content version in the same batch (contentVersionStatement): a
// passed-on tag is part of every photo of the camera.

export type CameraTagRow = {
  tag: string;
  /** Every photo with this camera has the tag too. */
  propagate: boolean;
  /** Whether the tag is public (the `tag` table). */
  public: boolean;
  position: number;
};

/** A camera's tags, in order. */
export const listCameraTags = async (
  db: D1Database,
  cameraId: number,
): Promise<CameraTagRow[]> => {
  const res = await db
    .prepare(
      `SELECT ct.tag, ct.propagate, COALESCE(t.public, 0) AS public, ct.position
       FROM camera_tag ct LEFT JOIN tag t ON t.name = ct.tag
       WHERE ct.camera_id = ? ORDER BY ct.position, ct.tag`,
    )
    .bind(cameraId)
    .all<{
      tag: string;
      propagate: number;
      public: number;
      position: number;
    }>();
  return (res.results ?? []).map((r) => ({
    tag: r.tag,
    propagate: r.propagate === 1,
    public: r.public === 1,
    position: r.position,
  }));
};

/**
 * Give a camera a tag at the end of its tags, passed on to its photos
 * unless `propagate` is false; a tag seen for the first time gets a
 * private `tag` row. False if the camera already has it.
 */
export const addCameraTag = async (
  db: D1Database,
  cameraId: number,
  tag: string,
  propagate = true,
  position?: number,
): Promise<{ added: boolean; newTag: boolean }> => {
  const [had, , inserted] = await db.batch<{ n: number }>([
    db.prepare("SELECT COUNT(*) AS n FROM tag WHERE name = ?").bind(tag),
    db
      .prepare(
        "INSERT INTO tag (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
      )
      .bind(tag),
    db
      .prepare(
        `INSERT INTO camera_tag (camera_id, tag, propagate, position)
         VALUES (?1, ?2, ?3, COALESCE(?4, (SELECT COALESCE(MAX(position) + 1, 0)
                                             FROM camera_tag WHERE camera_id = ?1)))
         ON CONFLICT (camera_id, tag) DO NOTHING
         RETURNING 1 AS n`,
      )
      .bind(cameraId, tag, propagate ? 1 : 0, position ?? null),
    contentVersionStatement(db),
  ]);
  return {
    added: (inserted.results ?? []).length > 0,
    newTag: ((had.results ?? [])[0]?.n ?? 0) === 0,
  };
};

/** Take a tag off a camera; what it was, for the undo. */
export const removeCameraTag = async (
  db: D1Database,
  cameraId: number,
  tag: string,
): Promise<{ tag: string; propagate: boolean; position: number } | null> => {
  const [deleted] = await db.batch<{
    tag: string;
    propagate: number;
    position: number;
  }>([
    db
      .prepare(
        `DELETE FROM camera_tag WHERE camera_id = ? AND tag = ?
         RETURNING tag, propagate, position`,
      )
      .bind(cameraId, tag),
    contentVersionStatement(db),
  ]);
  const row = (deleted.results ?? [])[0];
  return row
    ? { tag: row.tag, propagate: row.propagate === 1, position: row.position }
    : null;
};

/** Pass a camera's tag on to its photos or not. */
export const setCameraTagPropagate = async (
  db: D1Database,
  cameraId: number,
  tag: string,
  propagate: boolean,
): Promise<boolean> => {
  const [updated] = await db.batch<{ n: number }>([
    db
      .prepare(
        "UPDATE camera_tag SET propagate = ? WHERE camera_id = ? AND tag = ? RETURNING 1 AS n",
      )
      .bind(propagate ? 1 : 0, cameraId, tag),
    contentVersionStatement(db),
  ]);
  return (updated.results ?? []).length > 0;
};

/** The tags each camera passes on to its photos, by camera id. */
export const passedOnTags = async (
  db: D1Database,
): Promise<Map<number, string[]>> => {
  const res = await db
    .prepare(
      `SELECT camera_id, tag FROM camera_tag WHERE propagate = 1
       ORDER BY camera_id, position, tag`,
    )
    .all<{ camera_id: number; tag: string }>();
  const out = new Map<number, string[]>();
  for (const r of res.results ?? []) {
    out.set(r.camera_id, [...(out.get(r.camera_id) ?? []), r.tag]);
  }
  return out;
};

/** The tags one camera passes on (none for no camera). */
export const passedOnBy = async (
  db: D1Database,
  cameraId: number | null,
): Promise<string[]> =>
  cameraId === null
    ? []
    : (
        (
          await db
            .prepare(
              `SELECT tag FROM camera_tag WHERE camera_id = ? AND propagate = 1
               ORDER BY position, tag`,
            )
            .bind(cameraId)
            .all<{ tag: string }>()
        ).results ?? []
      ).map((r) => r.tag);

/** A photo's tags: its own and its camera's passed-on ones. */
export const photoTags = (
  own: readonly string[],
  cameraId: number | null,
  passed: ReadonlyMap<number, readonly string[]>,
): string[] =>
  effectiveTags(own, cameraId === null ? [] : passed.get(cameraId));
