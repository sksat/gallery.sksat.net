// D1 side of the upload rules (upload-rules.ts): the `setting` row, and
// applying the rules to photos that are already uploaded. Covered by
// db-upload-rules.spec.ts on the real schema.

import { storedOverrides } from "./bulk-metadata";
import type { NewRow } from "./db-upload";
import { contentVersionStatement } from "./last-good";
import { parseOverrides } from "./metadata";
import { normalizeExif } from "./photo-meta";
import { LIVE_PHOTO, type MediaPlatform } from "./types";
import type { UploadInit } from "./upload";
import {
  FALLBACK_PLATFORM,
  UPLOAD_RULES_KEY,
  appliedChips,
  applyUploadRules,
  decidedLevels,
  existingChange,
  parseStoredRules,
  type AppliedChip,
  type ExistingPhoto,
  type UploadRule,
} from "./upload-rules";

/** The rules (the built-in defaults while nothing was saved): one row. */
export const getUploadRules = async (db: D1Database): Promise<UploadRule[]> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(UPLOAD_RULES_KEY)
    .first<{ value: string }>();
  return parseStoredRules(row?.value);
};

export const setUploadRules = async (
  db: D1Database,
  rules: readonly UploadRule[],
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO setting (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = ?2,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(UPLOAD_RULES_KEY, JSON.stringify(rules))
    .run();
};

/** Camera names by id (the camera table only; no photo counts). */
export const cameraNames = async (
  db: D1Database,
): Promise<{ id: number; name: string }[]> =>
  (
    await db
      .prepare("SELECT id, name FROM camera ORDER BY name COLLATE NOCASE, id")
      .all<{ id: number; name: string }>()
  ).results ?? [];

/**
 * What the rules decide for an upload of `init` (on its requested path,
 * so a numbered name still matches its pattern): the new row's values
 * and the chips the panel shows. One read for the rules, and one of the
 * cameras they name (if any).
 */
export const decideUpload = async (
  db: D1Database,
  init: UploadInit,
): Promise<{
  row: Omit<NewRow, "publicId">;
  applied: AppliedChip[];
}> => {
  const stored = await getUploadRules(db);
  // The cameras the rules name (their names for the chips); a rule whose
  // camera is gone does not set one, so a lower rule's camera still can.
  const ids = [...new Set(stored.flatMap((r) => r.actions.cameraId ?? []))];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const res = await db
      .prepare(
        "SELECT id, name FROM camera WHERE id IN (SELECT value FROM json_each(?))",
      )
      .bind(JSON.stringify(ids))
      .all<{ id: number; name: string }>();
    for (const c of res.results ?? []) names.set(c.id, c.name);
  }
  const rules = stored.map((r) => {
    if (r.actions.cameraId === undefined || names.has(r.actions.cameraId)) {
      return r;
    }
    const actions = { ...r.actions };
    delete actions.cameraId;
    return { ...r, actions };
  });
  const meta = init.meta;
  // Without `meta` the file was not read: its world and GPS are unknown.
  const d = applyUploadRules(rules, {
    path: init.file,
    creatorTool: init.hints ? init.hints.creatorTool : undefined,
    // From the header (the init's width / height), unknown when not read.
    dimensions: init.dimensions,
    hasWorld: meta ? meta.world !== null : undefined,
    exif: meta?.exif ?? null,
    hasGps: meta ? meta.location !== null : undefined,
  });
  return {
    row: {
      platform: d.platform?.value ?? FALLBACK_PLATFORM,
      cameraId: d.cameraId?.value ?? null,
      tags: d.tags.map((t) => t.value),
      visibility: d.visibility?.value ?? "private",
      metadataVisibility: decidedLevels(d),
    },
    applied: appliedChips(d, rules, names),
  };
};

type Row = {
  id: number;
  path: string;
  /** A key of the `platform` table (its REFERENCES keeps it there). */
  platform: MediaPlatform;
  camera_id: number | null;
  tags: string | null;
  metadata_visibility: string | null;
  exif: string | null;
  latitude: number | null;
  world_id: string | null;
  world_name: string | null;
  metadata_read_at: string | null;
  /** metadata_source.camera ('manual' when chosen or cleared by hand). */
  camera_source: string | null;
};

const COLUMNS =
  "id, path, platform, camera_id, tags, metadata_visibility, exif, latitude, world_id, world_name, metadata_read_at, json_extract(metadata_source, '$.camera') AS camera_source";

export const parseTags = (raw: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
};

const parseExif = (raw: string | null) => {
  try {
    return normalizeExif(JSON.parse(raw ?? "null"));
  } catch {
    return null;
  }
};

/** A stored photo's change under `rules` (CreatorTool and size unknown). */
const changeOf = (rules: readonly UploadRule[], r: Row) => {
  const photo: ExistingPhoto = {
    id: r.id,
    platform: r.platform,
    camera_id: r.camera_id,
    cameraManual: r.camera_source === "manual",
    tags: parseTags(r.tags),
    metadata_visibility: parseOverrides(r.metadata_visibility),
  };
  // Until the original has been read, no world / GPS says nothing.
  // (A time; a reader may later also park "reading:…" / "failed:…" here.)
  const read = r.metadata_read_at !== null && /^\d/.test(r.metadata_read_at);
  const d = applyUploadRules(rules, {
    path: r.path,
    hasWorld: read ? r.world_id !== null || r.world_name !== null : undefined,
    exif: parseExif(r.exif),
    hasGps: read ? r.latitude !== null : undefined,
  });
  return existingChange(photo, d);
};

/**
 * A folder's live photos (?1 = "/a/*"), read through the path index (a
 * range over the folder); left to itself the planner picks the status or
 * trash index, which reads every photo.
 */
export const FOLDER_SQL = `SELECT ${COLUMNS} FROM media INDEXED BY idx_media_path_live
  WHERE ${LIVE_PHOTO} AND path GLOB ?1`;

export type ExistingPreview = {
  /** Photos in the folder. */
  photos: number;
  /** Those the rules would change, by id. */
  ids: number[];
  /** Photos each rule would change, by rule id. */
  byRule: Record<string, number>;
};

/**
 * What the rules would change in `folder` and below ("/" = everywhere).
 * Reads each photo there once (the path index narrows it to the folder).
 */
export const previewExisting = async (
  db: D1Database,
  rules: readonly UploadRule[],
  folder: string,
): Promise<ExistingPreview> => {
  const all = folder === "/";
  const rows =
    (
      await db
        .prepare(
          all
            ? `SELECT ${COLUMNS} FROM media WHERE ${LIVE_PHOTO} ORDER BY id`
            : `${FOLDER_SQL} ORDER BY id`,
        )
        .bind(...(all ? [] : [`${folder}/*`]))
        .all<Row>()
    ).results ?? [];
  const ids: number[] = [];
  const byRule: Record<string, number> = {};
  for (const r of rows) {
    const c = changeOf(rules, r);
    if (!c) continue;
    ids.push(r.id);
    for (const id of c.ruleIds) byRule[id] = (byRule[id] ?? 0) + 1;
  }
  return { photos: rows.length, ids, byRule };
};

/** What a photo had before applyExisting changed it (for the undo). */
export type ExistingBefore = {
  id: number;
  platform: MediaPlatform;
  camera_id: number | null;
  /** metadata_source.camera before ('manual' / 'file' / none). */
  camera_source: "manual" | "file" | null;
  tags: string | null;
  metadata_visibility: string | null;
};

/**
 * Apply the rules to photos `ids` (at most a chunk of 100), recomputed
 * from what they have now. Returns what each changed photo had before.
 */
export const applyExisting = async (
  db: D1Database,
  rules: readonly UploadRule[],
  ids: readonly number[],
): Promise<ExistingBefore[]> => {
  if (ids.length === 0) return [];
  const rows =
    (
      await db
        .prepare(
          `SELECT ${COLUMNS} FROM media WHERE ${LIVE_PHOTO}
           AND id IN (SELECT value FROM json_each(?)) ORDER BY id`,
        )
        .bind(JSON.stringify(ids))
        .all<Row>()
    ).results ?? [];
  const before: ExistingBefore[] = [];
  const updates: D1PreparedStatement[] = [];
  const newTags = new Set<string>();
  for (const r of rows) {
    const c = changeOf(rules, r);
    if (!c) continue;
    before.push({
      id: r.id,
      platform: r.platform,
      camera_id: r.camera_id,
      camera_source:
        r.camera_source === "manual" || r.camera_source === "file"
          ? r.camera_source
          : null,
      tags: r.tags,
      metadata_visibility: r.metadata_visibility,
    });
    const had = parseTags(r.tags);
    c.tags?.forEach((t) => {
      if (!had.includes(t)) newTags.add(t);
    });
    updates.push(
      db
        .prepare(
          // A camera a rule sets is a choice, as on the edit page: the
          // metadata reader never replaces it (metadata_source.camera).
          `UPDATE media SET platform = ?2, camera_id = ?3, tags = ?4,
             metadata_visibility = ?5,
             metadata_source = CASE WHEN ?6 THEN json_set(
               COALESCE(metadata_source, '{}'), '$.camera', 'manual')
               ELSE metadata_source END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?1`,
        )
        .bind(
          r.id,
          c.platform ?? r.platform,
          c.camera_id ?? r.camera_id,
          c.tags ? JSON.stringify(c.tags) : r.tags,
          c.metadata_visibility
            ? JSON.stringify(c.metadata_visibility)
            : r.metadata_visibility,
          c.camera_id !== undefined ? 1 : 0,
        ),
    );
  }
  if (updates.length === 0) return before;
  // In the same batch (one transaction): new tags get their private row
  // together with the photos that use them, and the API's content version
  // moves with them (a listed photo's platform, camera, tags or levels).
  await db.batch([
    contentVersionStatement(db),
    ...(newTags.size > 0
      ? [
          db
            .prepare(
              `INSERT INTO tag (name) SELECT value FROM json_each(?)
               WHERE true ON CONFLICT (name) DO NOTHING`,
            )
            .bind(JSON.stringify([...newTags])),
        ]
      : []),
    ...updates,
  ]);
  return before;
};

/**
 * Undo of applyExisting: each photo's values as they were. They come back
 * from the browser, so the tags and levels are written only in their
 * valid shape (as the edit page would store them).
 */
export const restoreExisting = async (
  db: D1Database,
  before: readonly ExistingBefore[],
): Promise<void> => {
  if (before.length === 0) return;
  await db.batch([
    contentVersionStatement(db),
    ...before.map((b) =>
      db
        .prepare(
          // The camera's source key as it was (a null removes it); the
          // other keys of metadata_source stay as they are now.
          `UPDATE media SET platform = ?2, camera_id = ?3,
             tags = COALESCE(?4, tags), metadata_visibility = ?5,
             metadata_source = NULLIF(json_patch(COALESCE(metadata_source, '{}'),
               json_object('camera', ?6)), '{}'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?1`,
        )
        .bind(
          b.id,
          b.platform,
          b.camera_id,
          b.tags === null ? null : JSON.stringify(parseTags(b.tags)),
          storedOverrides(parseOverrides(b.metadata_visibility)),
          b.camera_source,
        ),
    ),
  ]);
};
