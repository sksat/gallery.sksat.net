// Renaming a tag on /tag/ (and merging it into another by renaming it to
// that one's name). A tag's name is stored, as the name itself, in:
//   - tag.name (its public flag; fields hang off tag.id, migration 0010,
//     so a renamed tag keeps them, and the photos' values keyed by field
//     id, media.tag_values / tag_value_visibility, need nothing),
//   - media.tags (each photo's own tags, a JSON array; also the photos in
//     the trash and uploads not completed, so they come back right),
//   - media.tag_visibility (0021: a photo's choices, keyed by name; a
//     photo may hide a tag it has only through its camera, so it is
//     searched apart from media.tags),
//   - camera_tag.tag (0011),
//   - the upload rules' tags (the `setting` row upload_rules).
// One read finds them (a pass over media through json_each(media.tags):
// a rare action) and one D1 batch rewrites them all with the content
// version bump. What it returns is enough to undo it exactly
// (unrenameTag). The pure part is tag-rename.ts; db-tag-rename.spec.ts
// runs this on the real schema.

import { contentVersionStatement } from "./last-good";
import {
  parseChoiceMap,
  parseTagList,
  renameInChoices,
  renameInList,
  storedChoiceMap,
  unrenameInChoices,
  unrenameInList,
  type TagChoiceMap,
} from "./tag-rename";
import { UPLOAD_RULES_KEY } from "./upload-rules";

type TagRowBefore = { id: number; public: boolean; createdAt: string };

type CameraTagBefore = {
  cameraId: number;
  tag: string;
  propagate: boolean;
  position: number;
  createdAt: string;
};

/** A photo's columns before the rename (only those that name tags). */
export type PhotoTagsBefore = {
  id: number;
  tags: string[];
  /**
   * Its choices per tag (0021, media.tag_visibility), or null for none.
   * Always set by renameTag; absent only in an undo from before 0021.
   */
  tagVisibility?: TagChoiceMap | null;
};

/** What a rename changed: everything its undo puts back. */
export type TagRename = {
  from: string;
  to: string;
  /** `to` was a tag already: the two were merged. */
  merged: boolean;
  /** `from`'s tag row, when it had one. */
  fromRow: TagRowBefore | null;
  /** Whether `to` had a tag row (then it is the one kept). */
  toHadRow: boolean;
  /** Fields moved from `from` to `to` (a merge where only `from` had any). */
  movedFields: number[];
  /** camera_tag rows of `from` and `to` of every camera that had `from`. */
  cameras: CameraTagBefore[];
  /** Upload rules that had `from`: their id and tags before. */
  rules: { id: string; tags: string[] }[];
  photos: PhotoTagsBefore[];
};

export type RenameResult =
  | { ok: true; value: TagRename }
  | {
      ok: false;
      error: string;
      code: "same" | "missing" | "exists" | "fields" | "conflict";
    };

type RawTagRow = {
  id: number;
  name: string;
  public: number;
  created_at: string;
  /** Its field ids, a JSON array. */
  fields: string;
};

type RawCameraTag = {
  camera_id: number;
  tag: string;
  propagate: number;
  position: number;
  created_at: string;
};

type RawRule = { id?: unknown; actions?: { tags?: unknown } };

const parseRules = (raw: string | null | undefined): RawRule[] | null => {
  if (raw == null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as RawRule[]) : null;
  } catch {
    return null;
  }
};

const ruleTags = (r: RawRule): string[] | null => {
  const t = r?.actions?.tags;
  return Array.isArray(t) && t.every((x) => typeof x === "string") ? t : null;
};

/** The upload rules with each rule's tags passed through `f` (raw JSON kept). */
const mapRuleTags = (
  rules: RawRule[],
  f: (id: string, tags: string[]) => readonly string[],
): RawRule[] =>
  rules.map((r) => {
    const tags = ruleTags(r);
    if (!tags || typeof r.id !== "string") return r;
    const next = f(r.id, tags);
    return next === tags ? r : { ...r, actions: { ...r.actions, tags: next } };
  });

/**
 * Every row with either name (?1, ?2; in the trash or uploading too):
 * the one pass over media (scripts/bench-queries.ts counts its rows).
 */
export const FIND_TAGGED_SQL = `SELECT id, tags, tag_visibility FROM media
 WHERE (json_valid(tags) AND EXISTS (
   SELECT 1 FROM json_each(media.tags) j
   WHERE j.type = 'text' AND j.value IN (?1, ?2)))
 OR (tag_visibility IS NOT NULL AND EXISTS (
   SELECT 1 FROM json_each(media.tag_visibility) k
   WHERE k.key IN (?1, ?2)))`;

/** [id, tags before, tags after, choices before, choices after]. */
type PhotoWrite = readonly [
  number,
  string,
  string,
  string | null,
  string | null,
];

// One statement whatever the count (D1 caps bound parameters at 100), read
// once through json_each and joined on the primary key. A photo whose tags
// or choices changed meanwhile is left (the guards).
export const SET_TAGS_SQL = `UPDATE media SET tags = p.next,
   tag_visibility = p.next_tv,
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM (SELECT json_extract(value, '$[0]') AS id,
              json_extract(value, '$[1]') AS prev,
              json_extract(value, '$[2]') AS next,
              json_extract(value, '$[3]') AS prev_tv,
              json_extract(value, '$[4]') AS next_tv
       FROM json_each(?1)) AS p
 WHERE media.id = p.id AND media.tags = p.prev
   AND media.tag_visibility IS p.prev_tv`;

/** Stored choices after the rename: as stored when it changes nothing. */
const renamedChoices = (
  raw: string | null,
  choices: TagChoiceMap | null,
  from: string,
  to: string,
): string | null => {
  if (choices === null) return raw;
  const next = renameInChoices(choices, from, to);
  return next === choices ? raw : storedChoiceMap(next);
};

const setTags = (
  db: D1Database,
  rows: readonly PhotoWrite[],
): D1PreparedStatement => db.prepare(SET_TAGS_SQL).bind(JSON.stringify(rows));

const setRules = (
  db: D1Database,
  prev: string,
  next: RawRule[],
): D1PreparedStatement =>
  db
    .prepare(
      `UPDATE setting SET value = ?3,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE key = ?1 AND value = ?2`,
    )
    .bind(UPLOAD_RULES_KEY, prev, JSON.stringify(next));

// The guarded writes (photos, rules) change nothing where a row changed
// after the read. Each is followed by this check, which fails the batch
// (malformed JSON; a D1 batch is a transaction, so nothing is written)
// unless the write changed `n` rows: either every place is rewritten or
// none is.
const CONFLICT_MARK = "malformed JSON";
const changed = (db: D1Database, n: number): D1PreparedStatement =>
  db
    .prepare(
      "SELECT json(CASE WHEN changes() = ?1 THEN '0' ELSE '!' END) AS ok",
    )
    .bind(n);

/** Run the batch; false when a check failed (nothing was written). */
const commit = async (
  db: D1Database,
  stmts: D1PreparedStatement[],
): Promise<boolean> => {
  try {
    await db.batch(stmts);
    return true;
  } catch (err) {
    if (
      String(err instanceof Error ? err.message : err).includes(CONFLICT_MARK)
    )
      return false;
    throw err;
  }
};

const CONFLICT = {
  ok: false as const,
  code: "conflict" as const,
  error: "ほかの変更と重なりました。もう一度試してください",
};

/**
 * Rename the tag `from` to `to` everywhere. When `to` is a tag already
 * (a row, or on a photo or camera) it is a merge, done only with
 * `merge` (the page asks first): the photos of both have `to`, which
 * keeps its public flag; `from`'s fields move to it when `to` has none,
 * and when both have fields it is refused (they cannot be told apart
 * again except by the undo).
 */
export const renameTag = async (
  db: D1Database,
  from: string,
  to: string,
  merge: boolean,
): Promise<RenameResult> => {
  if (from === to) {
    return { ok: false, code: "same", error: "同じ名前です" };
  }
  const [tagRows, cameraRows, ruleRow, mediaRows] = await db.batch<unknown>([
    db
      .prepare(
        `SELECT id, name, public, created_at,
                (SELECT json_group_array(f.id) FROM tag_field f
                 WHERE f.tag_id = tag.id) AS fields
         FROM tag WHERE name IN (?1, ?2)`,
      )
      .bind(from, to),
    db
      .prepare(
        `SELECT camera_id, tag, propagate, position, created_at FROM camera_tag
         WHERE tag IN (?1, ?2)`,
      )
      .bind(from, to),
    db
      .prepare("SELECT value FROM setting WHERE key = ?")
      .bind(UPLOAD_RULES_KEY),
    db.prepare(FIND_TAGGED_SQL).bind(from, to),
  ]);
  const tags = ((tagRows.results ?? []) as RawTagRow[]).map((t) => ({
    ...t,
    fields: (JSON.parse(t.fields) as number[]).sort((a, b) => a - b),
  }));
  const fromRow = tags.find((t) => t.name === from) ?? null;
  const toRow = tags.find((t) => t.name === to) ?? null;
  const cams = (cameraRows.results ?? []) as RawCameraTag[];
  const ruleRaw =
    ((ruleRow.results ?? [])[0] as { value: string } | undefined)?.value ??
    null;
  const rules = parseRules(ruleRaw);
  const photos = (
    (mediaRows.results ?? []) as {
      id: number;
      tags: string;
      tag_visibility: string | null;
    }[]
  )
    .map((r) => ({
      id: r.id,
      raw: r.tags,
      tags: parseTagList(r.tags),
      rawTv: r.tag_visibility,
      tv: parseChoiceMap(r.tag_visibility),
    }))
    .filter(
      (
        r,
      ): r is {
        id: number;
        raw: string;
        tags: string[];
        rawTv: string | null;
        tv: TagChoiceMap | null;
      } => r.tags !== null,
    );

  // Photos that name `from`: in their tags, or in their choices (a tag
  // they have only through a camera).
  const fromPhotos = photos.filter(
    (p) => p.tags.includes(from) || (p.tv !== null && Object.hasOwn(p.tv, from)),
  );
  const fromCams = new Set(
    cams.filter((c) => c.tag === from).map((c) => c.camera_id),
  );
  const fromRules = (rules ?? []).filter(
    (r) => typeof r.id === "string" && ruleTags(r)?.includes(from),
  );
  if (
    !fromRow &&
    fromPhotos.length === 0 &&
    fromCams.size === 0 &&
    fromRules.length === 0
  ) {
    return { ok: false, code: "missing", error: `『${from}』がありません` };
  }
  const exists =
    toRow !== null ||
    cams.some((c) => c.tag === to) ||
    photos.some((p) => p.tags.includes(to)) ||
    (rules ?? []).some((r) => ruleTags(r)?.includes(to));
  if (exists && !merge) {
    return { ok: false, code: "exists", error: `『${to}』はもうあります` };
  }
  if (
    fromRow &&
    toRow &&
    fromRow.fields.length > 0 &&
    toRow.fields.length > 0
  ) {
    return {
      ok: false,
      code: "fields",
      error: `『${from}』と『${to}』の両方に項目があるため、まとめられません`,
    };
  }

  const stmts: D1PreparedStatement[] = [];
  let movedFields: number[] = [];
  if (fromRow && toRow) {
    if (fromRow.fields.length > 0) {
      movedFields = fromRow.fields;
      stmts.push(
        db
          .prepare("UPDATE tag_field SET tag_id = ?2 WHERE tag_id = ?1")
          .bind(fromRow.id, toRow.id),
      );
    }
    stmts.push(db.prepare("DELETE FROM tag WHERE id = ?").bind(fromRow.id));
  } else if (fromRow) {
    // The row becomes `to`'s, fields and all. Merged into a name with no
    // row (private), it is private too.
    stmts.push(
      db
        .prepare(
          `UPDATE tag SET name = ?2, public = CASE WHEN ?3 THEN 0 ELSE public END
           WHERE id = ?1`,
        )
        .bind(fromRow.id, to, exists ? 1 : 0),
    );
  }
  {
    // A camera with both keeps `to` (its place), passing it on if either
    // was. Always run, with checks, so a camera tagged after the read
    // fails the batch instead of being renamed outside the undo.
    const both = cams.filter(
      (c) => c.tag === to && fromCams.has(c.camera_id),
    ).length;
    stmts.push(
      db
        .prepare(
          `UPDATE camera_tag SET propagate = 1 WHERE tag = ?2 AND camera_id IN
             (SELECT camera_id FROM camera_tag WHERE tag = ?1 AND propagate = 1)`,
        )
        .bind(from, to),
      db
        .prepare(
          `DELETE FROM camera_tag WHERE tag = ?1 AND camera_id IN
             (SELECT camera_id FROM camera_tag WHERE tag = ?2)`,
        )
        .bind(from, to),
      changed(db, both),
      db
        .prepare("UPDATE camera_tag SET tag = ?2 WHERE tag = ?1")
        .bind(from, to),
      changed(db, fromCams.size - both),
    );
  }
  if (rules && ruleRaw !== null && fromRules.length > 0) {
    stmts.push(
      setRules(
        db,
        ruleRaw,
        mapRuleTags(rules, (_, t) => renameInList(t, from, to)),
      ),
      changed(db, 1),
    );
  }
  if (fromPhotos.length > 0) {
    stmts.push(
      setTags(
        db,
        fromPhotos.map(
          (p) =>
            [
              p.id,
              p.raw,
              JSON.stringify(renameInList(p.tags, from, to)),
              p.rawTv,
              renamedChoices(p.rawTv, p.tv, from, to),
            ] as const,
        ),
      ),
      changed(db, fromPhotos.length),
    );
  }
  stmts.push(contentVersionStatement(db));
  if (!(await commit(db, stmts))) return CONFLICT;

  return {
    ok: true,
    value: {
      from,
      to,
      merged: exists,
      fromRow: fromRow && {
        id: fromRow.id,
        public: fromRow.public === 1,
        createdAt: fromRow.created_at,
      },
      toHadRow: toRow !== null,
      movedFields,
      cameras: cams
        .filter((c) => fromCams.has(c.camera_id))
        .map((c) => ({
          cameraId: c.camera_id,
          tag: c.tag,
          propagate: c.propagate === 1,
          position: c.position,
          createdAt: c.created_at,
        })),
      rules: fromRules.map((r) => ({
        id: r.id as string,
        tags: ruleTags(r) ?? [],
      })),
      photos: fromPhotos.map((p) => ({
        id: p.id,
        tags: p.tags,
        tagVisibility: p.tv,
      })),
    },
  };
};

/**
 * Undo a rename: `from` back as it was (its row with its id and flag,
 * its fields, its cameras, rules and photos). A photo or rule edited
 * since keeps the edit; only the rename is taken back (unrenameInList).
 */
export const unrenameTag = async (
  db: D1Database,
  r: TagRename,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const ids = r.photos.map((p) => p.id);
  const camIds = [...new Set(r.cameras.map((c) => c.cameraId))];
  const [fromNow, ruleRow, mediaRows, camRows] = await db.batch<unknown>([
    db
      .prepare("SELECT id FROM tag WHERE name = ?1 AND id IS NOT ?2")
      .bind(r.from, r.toHadRow || !r.fromRow ? null : r.fromRow.id),
    db
      .prepare("SELECT value FROM setting WHERE key = ?")
      .bind(UPLOAD_RULES_KEY),
    db
      .prepare(
        // The renamed photos, and those of the cameras that had the old
        // name that hid the new one since (a tag their camera passes on,
        // with no choice when it was renamed).
        `SELECT id, tags, tag_visibility FROM media
         WHERE id IN (SELECT value FROM json_each(?1))
            OR (camera_id IN (SELECT value FROM json_each(?3))
                AND tag_visibility IS NOT NULL AND EXISTS (
                  SELECT 1 FROM json_each(media.tag_visibility) k
                  WHERE k.key = ?2))`,
      )
      .bind(
        JSON.stringify(ids),
        r.to,
        JSON.stringify(
          r.cameras.filter((c) => c.tag === r.from).map((c) => c.cameraId),
        ),
      ),
    db
      .prepare(
        `SELECT camera_id, tag, propagate, created_at FROM camera_tag
         WHERE tag IN (?1, ?2) AND camera_id IN (SELECT value FROM json_each(?3))`,
      )
      .bind(r.from, r.to, JSON.stringify(camIds)),
  ]);
  // Another tag took the old name meanwhile: it would be a merge.
  if (r.fromRow && (fromNow.results ?? []).length > 0) {
    return { ok: false, error: `『${r.from}』がもうあります` };
  }

  const stmts: D1PreparedStatement[] = [];
  if (r.fromRow && r.toHadRow) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO tag (id, name, public, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(
          r.fromRow.id,
          r.from,
          r.fromRow.public ? 1 : 0,
          r.fromRow.createdAt,
        ),
    );
    if (r.movedFields.length > 0) {
      stmts.push(
        // Only those still on `to`.
        db
          .prepare(
            `UPDATE tag_field SET tag_id = ?1
             WHERE id IN (SELECT value FROM json_each(?2))
               AND tag_id = (SELECT id FROM tag WHERE name = ?3)`,
          )
          .bind(r.fromRow.id, JSON.stringify(r.movedFields), r.to),
      );
    }
  } else if (r.fromRow) {
    stmts.push(
      db
        .prepare("UPDATE tag SET name = ?2, public = ?3 WHERE id = ?1")
        .bind(r.fromRow.id, r.from, r.fromRow.public ? 1 : 0),
    );
  }
  // Cameras: only the rename is taken back, so a change made to a camera's
  // tags since stays. Renamed: `to` becomes `from` again (as it is now).
  // Merged: `from` comes back as it was, and `to` gets its old
  // propagate back if the merge changed it and nothing has since.
  const now = (camRows.results ?? []) as {
    camera_id: number;
    tag: string;
    propagate: number;
    created_at: string;
  }[];
  const nowRow = (cam: number, tag: string) =>
    now.find((c) => c.camera_id === cam && c.tag === tag);
  const renameBack: number[] = [];
  const reinsert: CameraTagBefore[] = [];
  const propagateBack: [number, number][] = [];
  for (const cam of camIds) {
    const bFrom = r.cameras.find((c) => c.cameraId === cam && c.tag === r.from);
    const bTo = r.cameras.find((c) => c.cameraId === cam && c.tag === r.to);
    if (!bFrom || nowRow(cam, r.from)) continue;
    const cTo = nowRow(cam, r.to);
    if (!bTo) {
      // The renamed row itself (it keeps its created_at), not one added since.
      if (cTo && cTo.created_at === bFrom.createdAt) renameBack.push(cam);
      continue;
    }
    reinsert.push(bFrom);
    const merged = bFrom.propagate || bTo.propagate ? 1 : 0;
    const old = bTo.propagate ? 1 : 0;
    if (cTo && cTo.propagate === merged && merged !== old) {
      propagateBack.push([cam, old]);
    }
  }
  if (renameBack.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE camera_tag SET tag = ?1
           WHERE tag = ?2 AND camera_id IN (SELECT value FROM json_each(?3))`,
        )
        .bind(r.from, r.to, JSON.stringify(renameBack)),
    );
  }
  if (reinsert.length > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO camera_tag (camera_id, tag, propagate, position, created_at)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'),
                  json_extract(value, '$[2]'), json_extract(value, '$[3]'),
                  json_extract(value, '$[4]')
           FROM json_each(?1)
           WHERE EXISTS (SELECT 1 FROM camera
                         WHERE camera.id = json_extract(value, '$[0]'))
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          JSON.stringify(
            reinsert.map((c) => [
              c.cameraId,
              c.tag,
              c.propagate ? 1 : 0,
              c.position,
              c.createdAt,
            ]),
          ),
        ),
    );
  }
  if (propagateBack.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE camera_tag SET propagate = p.v
           FROM (SELECT json_extract(value, '$[0]') AS cam,
                        json_extract(value, '$[1]') AS v
                 FROM json_each(?2)) AS p
           WHERE camera_tag.tag = ?1 AND camera_tag.camera_id = p.cam`,
        )
        .bind(r.to, JSON.stringify(propagateBack)),
    );
  }
  const ruleRaw =
    ((ruleRow.results ?? [])[0] as { value: string } | undefined)?.value ??
    null;
  const rules = parseRules(ruleRaw);
  if (rules && ruleRaw !== null && r.rules.length > 0) {
    const before = new Map(r.rules.map((x) => [x.id, x.tags]));
    stmts.push(
      setRules(
        db,
        ruleRaw,
        mapRuleTags(rules, (id, t) => {
          const b = before.get(id);
          return b ? unrenameInList(t, b, r.from, r.to) : t;
        }),
      ),
      changed(db, 1),
    );
  }
  const before = new Map(r.photos.map((p) => [p.id, p]));
  const rows = (
    (mediaRows.results ?? []) as {
      id: number;
      tags: string;
      tag_visibility: string | null;
    }[]
  ).flatMap((m): PhotoWrite[] => {
    const now = parseTagList(m.tags);
    const b = before.get(m.id);
    if (!now) return [];
    if (!b) {
      // Not renamed, but hides the new name now, which its camera passes
      // on: it hides the old one too, never shows it.
      const tv = parseChoiceMap(m.tag_visibility) ?? {};
      if (
        !Object.hasOwn(tv, r.to) ||
        tv[r.to] !== "hidden" ||
        Object.hasOwn(tv, r.from)
      ) {
        return [];
      }
      const next = { ...tv };
      Object.defineProperty(next, r.from, {
        value: "hidden",
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return [[m.id, m.tags, m.tags, m.tag_visibility, storedChoiceMap(next)]];
    }
    const next = unrenameInList(now, b.tags, r.from, r.to);
    // Choices: back as they were, or only the rename taken back (an older
    // undo without them leaves the choices as they are).
    const tvNow = parseChoiceMap(m.tag_visibility) ?? {};
    const tvNext =
      b.tagVisibility === undefined
        ? tvNow
        : unrenameInChoices(tvNow, b.tagVisibility ?? {}, r.from, r.to);
    const tvSame = JSON.stringify(tvNext) === JSON.stringify(tvNow);
    if (next === now && tvSame) return [];
    return [
      [
        m.id,
        m.tags,
        JSON.stringify(next),
        m.tag_visibility,
        tvSame ? m.tag_visibility : storedChoiceMap(tvNext),
      ],
    ];
  });
  if (rows.length > 0) stmts.push(setTags(db, rows), changed(db, rows.length));
  stmts.push(contentVersionStatement(db));
  if (!(await commit(db, stmts))) return CONFLICT;
  return { ok: true };
};
