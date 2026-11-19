// Fields of a tag (migration 0010): their definitions (`tag_field`, edited
// on /tag/) and each photo's values (`media.tag_values`) and own levels
// (`media.tag_value_visibility`). The checks are shared with the API
// Worker (@shared/tag-field). db-tag-field.spec.ts runs these on the real
// schema.

import {
  normalizeValue,
  parseValueMap,
  readValue,
  rowToDef,
  TAG_FIELD_LIMITS,
  isTagFieldLevel,
  type TagFieldDef,
  type TagFieldLevel,
  type TagFieldType,
  type TagFieldValue,
} from "@shared/tag-field/tag-field";
import { contentChanged, contentVersionStatement } from "./last-good";
import { LIVE_PHOTO } from "./types";

type RawField = {
  id: number;
  tag: string;
  label: string;
  type: string;
  options: string | null;
  visibility: string;
  position: number;
};

const FIELD_SELECT = `SELECT f.id, t.name AS tag, f.label, f.type, f.options,
    f.visibility, f.position
  FROM tag_field f JOIN tag t ON t.id = f.tag_id`;

const toDefs = (rows: RawField[] | undefined) =>
  (rows ?? []).map(rowToDef).filter((d): d is TagFieldDef => d !== null);

/** Every field of every tag, by tag name and then position. */
export const listTagFields = async (db: D1Database): Promise<TagFieldDef[]> => {
  const res = await db
    .prepare(`${FIELD_SELECT} ORDER BY t.name, f.position, f.id`)
    .all<RawField>();
  return toDefs(res.results);
};

/** The fields of the given tags, in their order. */
export const fieldsOfTags = async (
  db: D1Database,
  tags: readonly string[],
): Promise<TagFieldDef[]> => {
  if (tags.length === 0) return [];
  const res = await db
    .prepare(
      `${FIELD_SELECT} WHERE t.name IN (SELECT value FROM json_each(?))
       ORDER BY t.name, f.position, f.id`,
    )
    .bind(JSON.stringify(tags))
    .all<RawField>();
  return toDefs(res.results);
};

/**
 * How many listed photos have a value for each field (by field id), for
 * the warning before a field is removed. One pass over media.
 */
export const countTagValues = async (
  db: D1Database,
): Promise<Record<string, number>> => {
  const res = await db
    .prepare(
      `SELECT j.key AS id, COUNT(*) AS n
       FROM media, json_each(media.tag_values) j
       WHERE ${LIVE_PHOTO} AND media.tag_values IS NOT NULL
       GROUP BY j.key`,
    )
    .all<{ id: string; n: number }>();
  return Object.fromEntries((res.results ?? []).map((r) => [r.id, r.n]));
};

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: string };

const isUniqueError = (err: unknown) =>
  String(err instanceof Error ? err.message : err).includes("UNIQUE");

/**
 * A new field at the end of `tag`'s fields (the tag gets a `tag` row,
 * private, if it had none).
 */
export const addTagField = async (
  db: D1Database,
  tag: string,
  input: { label: string; type: TagFieldType; options: string[] | null },
): Promise<Result<TagFieldDef>> => {
  await db
    .prepare("INSERT INTO tag (name) VALUES (?) ON CONFLICT (name) DO NOTHING")
    .bind(tag)
    .run();
  const n = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM tag_field
       WHERE tag_id = (SELECT id FROM tag WHERE name = ?)`,
    )
    .bind(tag)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= TAG_FIELD_LIMITS.fields) {
    return {
      ok: false,
      error: `項目は 1 つのタグに ${TAG_FIELD_LIMITS.fields} 個までです`,
    };
  }
  try {
    // The field and the API's content version commit together.
    const [inserted] = await db.batch<{ id: number }>([
      db
        .prepare(
          `INSERT INTO tag_field (tag_id, label, type, options, position)
           SELECT t.id, ?2, ?3, ?4,
                  COALESCE((SELECT MAX(position) + 1 FROM tag_field
                            WHERE tag_id = t.id), 0)
           FROM tag t WHERE t.name = ?1
           RETURNING id`,
        )
        .bind(
          tag,
          input.label,
          input.type,
          input.options ? JSON.stringify(input.options) : null,
        ),
      contentVersionStatement(db),
    ]);
    const row = (inserted.results ?? [])[0];
    if (!row) return { ok: false, error: "タグがありません" };
    const [def] = await fieldsById(db, [row.id]);
    return { ok: true, value: def };
  } catch (err) {
    if (isUniqueError(err)) {
      return { ok: false, error: `『${input.label}』はもうあります` };
    }
    throw err;
  }
};

const fieldsById = async (db: D1Database, ids: readonly number[]) => {
  const res = await db
    .prepare(`${FIELD_SELECT} WHERE f.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<RawField>();
  return toDefs(res.results);
};

export const getTagField = async (
  db: D1Database,
  id: number,
): Promise<TagFieldDef | null> => (await fieldsById(db, [id]))[0] ?? null;

/** What a field edit may change. */
export type FieldEdit = {
  label?: string;
  options?: string[];
  visibility?: TagFieldLevel;
};

/**
 * Change a field's label, options (select fields only) or default level.
 * Returns what it had before (for the undo).
 */
export const editTagField = async (
  db: D1Database,
  id: number,
  edit: FieldEdit,
): Promise<Result<{ before: FieldEdit; field: TagFieldDef }>> => {
  const current = await getTagField(db, id);
  if (!current) return { ok: false, error: "項目がありません" };
  const sets: string[] = [];
  const args: unknown[] = [];
  const before: FieldEdit = {};
  if (edit.label !== undefined && edit.label !== current.label) {
    sets.push("label = ?");
    args.push(edit.label);
    before.label = current.label;
  }
  if (edit.options !== undefined) {
    if (current.type !== "select") {
      return { ok: false, error: "選択肢のある項目ではありません" };
    }
    sets.push("options = ?");
    args.push(JSON.stringify(edit.options));
    before.options = current.options ?? [];
  }
  if (edit.visibility !== undefined && edit.visibility !== current.visibility) {
    sets.push("visibility = ?");
    args.push(edit.visibility);
    before.visibility = current.visibility;
  }
  if (sets.length === 0) {
    // Bumped anyway: doing it again after a failed bump bumps again.
    await contentChanged(db);
    return { ok: true, value: { before, field: current } };
  }
  try {
    await db.batch([
      db
        .prepare(`UPDATE tag_field SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...args, id),
      contentVersionStatement(db),
    ]);
  } catch (err) {
    if (isUniqueError(err)) {
      return { ok: false, error: `『${edit.label}』はもうあります` };
    }
    throw err;
  }
  const field = (await getTagField(db, id)) ?? current;
  return { ok: true, value: { before, field } };
};

/**
 * Move a field one place up (-1) or down (+1) among its tag's fields.
 * The positions are renumbered 0… in the new order, in one batch.
 */
export const moveTagField = async (
  db: D1Database,
  id: number,
  delta: -1 | 1,
): Promise<boolean> => {
  const res = await db
    .prepare(
      `SELECT id FROM tag_field
       WHERE tag_id = (SELECT tag_id FROM tag_field WHERE id = ?)
       ORDER BY position, id`,
    )
    .bind(id)
    .all<{ id: number }>();
  const ids = (res.results ?? []).map((r) => r.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await db.batch([
    db
      .prepare(
        `UPDATE tag_field SET position = (
           SELECT key FROM json_each(?1) WHERE value = tag_field.id)
         WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(ids)),
    contentVersionStatement(db),
  ]);
  return true;
};

/** A photo's patch of one column: field id → value (null removes). */
export type PhotoPatch = [
  id: number,
  patch: Record<string, string | number | null>,
];

/**
 * A JSON merge patch per photo on `column`, all in one statement (one
 * JSON parameter: D1 caps bound parameters at 100 per statement), joined
 * once (UPDATE … FROM), so it stays linear in the number of photos.
 */
const patchStatement = (
  db: D1Database,
  column: "tag_values" | "tag_value_visibility",
  rows: readonly PhotoPatch[],
) =>
  db
    .prepare(
      `UPDATE media SET
         ${column} = NULLIF(json_patch(COALESCE(media.${column}, '{}'), p.patch), '{}'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM (SELECT json_extract(value, '$[0]') AS id,
                    json_extract(value, '$[1]') AS patch
             FROM json_each(?1)) AS p
       WHERE media.id = p.id`,
    )
    .bind(JSON.stringify(rows));

/** A removed field, with what photos had for it: for its undo. */
export type RemovedField = {
  field: TagFieldDef;
  /** [photo id, value or null, own level or null] */
  values: [number, TagFieldValue | null, TagFieldLevel | null][];
};

const keyPath = (id: number) => `$."${id}"`;

/**
 * Remove a field and its values and levels from every photo (also those
 * in the trash), in one batch. Returns them for restoreTagField.
 */
export const removeTagField = async (
  db: D1Database,
  id: number,
): Promise<RemovedField | null> => {
  const field = await getTagField(db, id);
  if (!field) return null;
  const path = keyPath(id);
  const where = `json_type(tag_values, ?1) IS NOT NULL
                 OR json_type(tag_value_visibility, ?1) IS NOT NULL`;
  const res = await db
    .prepare(
      `SELECT id, json_extract(tag_values, ?1) AS v,
              json_extract(tag_value_visibility, ?1) AS l
       FROM media WHERE ${where}`,
    )
    .bind(path)
    .all<{ id: number; v: unknown; l: unknown }>();
  await db.batch([
    db.prepare("DELETE FROM tag_field WHERE id = ?").bind(id),
    db
      .prepare(
        `UPDATE media SET
           tag_values = NULLIF(json_remove(tag_values, ?1), '{}'),
           tag_value_visibility =
             NULLIF(json_remove(tag_value_visibility, ?1), '{}'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE ${where}`,
      )
      .bind(path),
    contentVersionStatement(db),
  ]);
  return {
    field,
    values: (res.results ?? []).map((r) => [
      r.id,
      readValue(field.type, r.v),
      isTagFieldLevel(r.l) ? r.l : null,
    ]),
  };
};

/**
 * Undo of removeTagField: the field again (same id and position) and the
 * photos' values, in one batch (the tag gets its row back if it lost
 * it). The undo comes back from the browser: the id must be one that was
 * given out and is free now, and each value must fit the field (a select
 * value no longer among its options is kept, as when it was read).
 * Fails when the label has been taken since.
 */
export const restoreTagField = async (
  db: D1Database,
  removed: RemovedField,
): Promise<Result> => {
  const { field } = removed;
  const key = String(field.id);
  const seq = await db
    .prepare(
      `SELECT (SELECT seq FROM sqlite_sequence WHERE name = 'tag_field') AS seq,
              EXISTS (SELECT 1 FROM tag_field WHERE id = ?) AS taken`,
    )
    .bind(field.id)
    .first<{ seq: number | null; taken: number }>();
  if (!seq || seq.taken || field.id > (seq.seq ?? 0)) {
    return { ok: false, error: "この項目は戻せません" };
  }
  const values: PhotoPatch[] = [];
  for (const [id, raw] of removed.values) {
    if (raw === null) continue;
    const v = normalizeValue(field, raw);
    const value = v.ok ? v.value : readValue(field.type, raw);
    if (value !== null) values.push([id, { [key]: value }]);
  }
  const levels: PhotoPatch[] = removed.values
    .filter(([, , l]) => l !== null)
    .map(([id, , l]) => [id, { [key]: l }]);
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO tag (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
        )
        .bind(field.tag),
      db
        .prepare(
          `INSERT INTO tag_field (id, tag_id, label, type, options, position, visibility)
           SELECT ?1, t.id, ?2, ?3, ?4, ?5, ?6 FROM tag t WHERE t.name = ?7`,
        )
        .bind(
          field.id,
          field.label,
          field.type,
          field.options ? JSON.stringify(field.options) : null,
          field.position,
          field.visibility,
          field.tag,
        ),
      patchStatement(db, "tag_values", values),
      patchStatement(db, "tag_value_visibility", levels),
      contentVersionStatement(db),
    ]);
  } catch (err) {
    if (isUniqueError(err)) {
      return { ok: false, error: `『${field.label}』はもうあります` };
    }
    throw err;
  }
  return { ok: true };
};

/**
 * A photo's tag field change (PATCH, the edit page) checked against the
 * fields: each value normalized for its field's type; an unknown field
 * id is an error.
 */
export const resolveTagValuePatch = async (
  db: D1Database,
  values: Record<string, unknown> | undefined,
  levels: Record<string, unknown> | undefined,
): Promise<
  | {
      ok: true;
      values?: Record<string, TagFieldValue | null>;
      levels?: Record<string, TagFieldLevel | null>;
    }
  | { ok: false; error: string }
> => {
  const ids = [
    ...new Set([...Object.keys(values ?? {}), ...Object.keys(levels ?? {})]),
  ].map(Number);
  if (ids.length === 0) return { ok: true };
  const defs = new Map(
    (await fieldsById(db, ids)).map((d) => [String(d.id), d]),
  );
  const outValues: Record<string, TagFieldValue | null> = {};
  const gone = "削除された項目があります。ページを読み込み直してください";
  for (const [id, raw] of Object.entries(values ?? {})) {
    const def = defs.get(id);
    if (!def) return { ok: false, error: gone };
    const v = normalizeValue(def, raw);
    if (!v.ok) return v;
    outValues[id] = v.value;
  }
  const outLevels: Record<string, TagFieldLevel | null> = {};
  for (const [id, level] of Object.entries(levels ?? {})) {
    if (!defs.has(id)) return { ok: false, error: gone };
    outLevels[id] = isTagFieldLevel(level) ? level : null;
  }
  return {
    ok: true,
    ...(values ? { values: outValues } : {}),
    ...(levels ? { levels: outLevels } : {}),
  };
};

/** A selected photo's tags and values, for the bulk sheet. */
export type TagValueInfo = {
  id: number;
  tags: string[];
  values: Record<string, unknown>;
};

export const listTagValueInfo = async (
  db: D1Database,
  ids: readonly number[],
): Promise<TagValueInfo[]> => {
  if (ids.length === 0) return [];
  const res = await db
    .prepare(
      `SELECT id, tags, tag_values FROM media
       WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: number; tags: string; tag_values: string | null }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    tags: parseTagList(r.tags),
    values: parseValueMap(r.tag_values),
  }));
};

/** media.tags read leniently (a malformed column has no tags). */
export const parseTagList = (raw: string | null | undefined): string[] => {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v)
      ? v.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * Set (or clear, null) fields on the photos `ids`: each field only on the
 * photos that have its tag. The values are checked against their fields
 * first; an unknown field fails the whole change. Returns, for each photo
 * that changed, what it had for those fields (null where none): the undo.
 */
export const setTagValues = async (
  db: D1Database,
  ids: readonly number[],
  change: Record<string, unknown>,
): Promise<Result<PhotoPatch[]>> => {
  const resolved = await resolveTagValuePatch(db, change, undefined);
  if (!resolved.ok) return resolved;
  const values = resolved.values ?? {};
  const defs = new Map(
    (await fieldsById(db, Object.keys(values).map(Number))).map((d) => [
      String(d.id),
      d,
    ]),
  );
  const next: PhotoPatch[] = [];
  const previous: PhotoPatch[] = [];
  for (const photo of await listTagValueInfo(db, ids)) {
    const patch: Record<string, TagFieldValue | null> = {};
    const before: Record<string, TagFieldValue | null> = {};
    for (const [id, value] of Object.entries(values)) {
      const def = defs.get(id)!;
      if (!photo.tags.includes(def.tag)) continue;
      // (Stored values that do not fit the field count as none.)
      const had = readValue(def.type, photo.values[id]);
      if (had === value) continue;
      patch[id] = value;
      before[id] = had;
    }
    if (Object.keys(patch).length === 0) continue;
    next.push([photo.id, patch]);
    previous.push([photo.id, before]);
  }
  // The values and the API's content version commit together (a bump
  // alone when nothing changed: doing it again bumps again).
  if (next.length > 0) {
    await db.batch([
      patchStatement(db, "tag_values", next),
      contentVersionStatement(db),
    ]);
  } else await contentChanged(db);
  return { ok: true, value: previous };
};

/**
 * Undo of setTagValues: each photo's fields back as they were. The values
 * were read from D1, but come back from the browser, so only what a
 * field of its type can hold is written (anything else is cleared).
 */
export const restoreTagValues = async (
  db: D1Database,
  previous: readonly PhotoPatch[],
): Promise<void> => {
  const ids = [...new Set(previous.flatMap(([, p]) => Object.keys(p)))];
  const defs = new Map(
    (await fieldsById(db, ids.map(Number))).map((d) => [String(d.id), d]),
  );
  const rows: PhotoPatch[] = previous.map(([id, patch]) => [
    id,
    Object.fromEntries(
      Object.entries(patch).map(([k, v]) => {
        const def = defs.get(k);
        if (!def || v === null) return [k, null];
        // As typed would be checked; a select value read before its
        // option was removed is kept.
        const n = normalizeValue(def, v);
        return [k, n.ok ? n.value : readValue(def.type, v)];
      }),
    ),
  ]);
  if (rows.length > 0) {
    await db.batch([
      patchStatement(db, "tag_values", rows),
      contentVersionStatement(db),
    ]);
  } else await contentChanged(db);
};
