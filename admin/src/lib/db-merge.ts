// Merging a photo that is a retouch of another into it (0020): the retouch
// photo's files become retouched versions (media_file role 'edit') of the
// other photo, its row goes away and its public id becomes an alias
// (media_alias) that the public site redirects to the merged photo. The
// alias keeps what undoing needs. Also the candidates for it (the merge
// page) and the photo an upload may be a retouch of (the upload panel).
// Covered by db-merge.spec.ts on the real schema.

import { numberedPaths, numberedRange } from "./db-upload";
import { contentVersionStatement } from "./last-good";
import {
  defaultMerge,
  findRetouchPairs,
  retouchSignals,
  splitName,
  uploadBaseStems,
  type RetouchSignals,
} from "./retouch-match";
import {
  LIVE_PHOTO,
  isVisibility,
  type MediaPlatform,
  type Visibility,
} from "./types";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Why a merge (or its undo) could not be made, in words for the page. */
export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeError";
  }
}

type Row = Record<string, string | number | null>;

/** What the alias keeps to undo a merge (media_alias.merged). */
type Snapshot = {
  /** The retouch photo's media row as it was. */
  photo: Row;
  /** Its media_file rows as they were, in id order. */
  files: Row[];
  /** The key of the file it showed. */
  shownKey: string;
  /** Aliases of the retouch photo (earlier merges into it). */
  aliases: string[];
  /** What the merge changed on the photo it went into, as it was. */
  into: {
    id: number;
    visibility: string;
    active_file_id: number | null;
  } & IntoFields;
  /**
   * What the merge set them to: an undo puts back only the ones still so
   * (a change made since stays).
   */
  set: IntoFields;
};

type IntoFields = {
  visibility: string;
  tags: string;
  camera_id: number | null;
  tag_values: string | null;
};

const parseObject = (raw: unknown): Record<string, unknown> => {
  try {
    const v = JSON.parse(String(raw ?? "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Columns of a media_file row copied when it moves to another photo. */
const FILE_COLUMNS = [
  "storage",
  "object_key",
  "status",
  "size",
  "sha256",
  "mime_type",
  "file_exif",
  "creator_tool",
  "xmp_summary",
  "metadata_read_at",
  "uploaded_at",
  "created_at",
  "trashed_at",
] as const;

/** Files ordered so that each comes after the file it was made from. */
const sourcesFirst = (files: Row[]): Row[] => {
  const out: Row[] = [];
  const done = new Set<number>();
  let rest = [...files];
  while (rest.length > 0) {
    const ready = rest.filter(
      (f) =>
        f.source_file_id === null ||
        done.has(f.source_file_id as number) ||
        !files.some((g) => g.id === f.source_file_id),
    );
    if (ready.length === 0)
      throw new MergeError("ファイルのつながりが読めません");
    for (const f of ready) {
      out.push(f);
      done.add(f.id as number);
    }
    rest = rest.filter((f) => !ready.includes(f));
  }
  return out;
};

/**
 * INSERT of `f` (a file of the retouch photo) into the photo whose id is
 * given by `mediaSql` (SQL), its source found by key (keys never change):
 * an original becomes an edit, made from that photo's original.
 */
const insertFile = (
  db: D1Database,
  f: Row,
  mediaSql: string,
  mediaArg: string | number,
  role: string,
  sourceKey: string | null,
  sourceIsOriginal: boolean,
) => {
  const cols = FILE_COLUMNS.map((c) => f[c] ?? null);
  const source = sourceIsOriginal
    ? `(SELECT o.id FROM media_file o WHERE o.media_id = ${mediaSql} AND o.role = 'original')`
    : sourceKey === null
      ? "NULL"
      : `(SELECT s.id FROM media_file s WHERE s.storage = 'b2' AND s.object_key = ?${FILE_COLUMNS.length + 3})`;
  return db
    .prepare(
      `INSERT INTO media_file (media_id, role, source_file_id, ${FILE_COLUMNS.join(", ")})
       VALUES (${mediaSql}, ?${FILE_COLUMNS.length + 2}, ${source},
         ${FILE_COLUMNS.map((_, i) => `?${i + 1}`).join(", ")})`,
    )
    .bind(
      ...cols,
      mediaArg,
      role,
      ...(sourceKey !== null && !sourceIsOriginal ? [sourceKey] : []),
    );
};

const parseTags = (raw: unknown): string[] => {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v)
      ? v.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
};

export type MergeOptions = {
  /** The photo that stays (the original). */
  into: number;
  /** The photo that goes into it (the retouch). */
  from: number;
  /** The merged photo's visibility (default: defaultMerge's). */
  visibility?: Visibility;
  /**
   * Show the retouch photo's file (else keep what `into` shows; default:
   * defaultMerge's).
   */
  show?: boolean;
};

/**
 * Merge photo `from` into photo `into`: `from`'s files become edits of
 * `into` (its original made from `into`'s original; keys, hashes and
 * metadata kept), its row goes, and its public id becomes an alias of
 * `into`. `into` keeps its id, public id and metadata; it gets `from`'s
 * tags too, its camera when it has none, the visibility asked for, and
 * shows `from`'s file when `show`. One D1 batch, with the content version.
 * Returns the alias (the undo's handle).
 */
export const mergePhotos = async (
  db: D1Database,
  opts: MergeOptions,
): Promise<{ alias: string }> => {
  if (opts.into === opts.from) throw new MergeError("同じ写真です");
  const [photos, files, pictures, aliases] = await db.batch<Row>([
    db
      .prepare(`SELECT * FROM media WHERE id IN (?1, ?2) AND ${LIVE_PHOTO}`)
      .bind(opts.into, opts.from),
    db
      .prepare("SELECT * FROM media_file WHERE media_id = ?1 ORDER BY id")
      .bind(opts.from),
    db
      .prepare("SELECT 1 FROM camera_image WHERE media_id = ?1 LIMIT 1")
      .bind(opts.from),
    db
      .prepare("SELECT public_id FROM media_alias WHERE media_id = ?1")
      .bind(opts.from),
  ]);
  const into = (photos.results ?? []).find((r) => r.id === opts.into);
  const from = (photos.results ?? []).find((r) => r.id === opts.from);
  if (!into || !from)
    throw new MergeError("写真がもうありません（再読み込み）");
  if ((pictures.results ?? []).length > 0) {
    throw new MergeError(
      `${from.path} はカメラの写真に使われています。先にカメラのページで外してください`,
    );
  }
  const fromFiles = files.results ?? [];
  if (fromFiles.some((f) => f.status !== "ready")) {
    throw new MergeError(`${from.path} に未完了のアップロードがあります`);
  }
  if (fromFiles.some((f) => f.storage !== "b2")) {
    throw new MergeError("B2 にないファイルはまだ移せません");
  }
  const original = fromFiles.find((f) => f.role === "original");
  if (!original)
    throw new MergeError(`${from.path} のファイルが見つかりません`);
  const shown = fromFiles.find((f) => f.id === from.active_file_id) ?? original;
  const defaults = defaultMerge(
    isVisibility(into.visibility) ? into.visibility : "private",
    isVisibility(from.visibility) ? from.visibility : "private",
  );
  // Never more visible than the original unless asked for.
  const visibility =
    opts.visibility ?? defaults.visibility ?? String(into.visibility);
  const show = opts.show ?? defaults.show;
  const tags = [...new Set([...parseTags(into.tags), ...parseTags(from.tags)])];
  // The original's values of tag fields win over the retouch's.
  const tagValues =
    from.tag_values === null || from.tag_values === undefined
      ? ((into.tag_values as string | null) ?? null)
      : JSON.stringify({
          ...parseObject(from.tag_values),
          ...parseObject(into.tag_values),
        });
  const set: IntoFields = {
    visibility,
    tags: JSON.stringify(tags),
    camera_id:
      (into.camera_id as number | null) ??
      (from.camera_id as number | null) ??
      null,
    tag_values: tagValues,
  };
  const snapshot: Snapshot = {
    photo: from,
    files: fromFiles,
    shownKey: String(shown.object_key),
    aliases: (aliases.results ?? []).map((a) => String(a.public_id)),
    into: {
      id: opts.into,
      visibility: String(into.visibility),
      active_file_id: (into.active_file_id as number | null) ?? null,
      tags: String(into.tags ?? "[]"),
      camera_id: (into.camera_id as number | null) ?? null,
      tag_values: (into.tag_values as string | null) ?? null,
    },
    set,
  };
  const keyOf = new Map(
    fromFiles.map((f) => [f.id as number, String(f.object_key)]),
  );
  const moved = sourcesFirst(fromFiles).map((f) =>
    f.role === "original"
      ? insertFile(
          db,
          f,
          "?" + (FILE_COLUMNS.length + 1),
          opts.into,
          "edit",
          null,
          true,
        )
      : insertFile(
          db,
          f,
          "?" + (FILE_COLUMNS.length + 1),
          opts.into,
          String(f.role),
          f.source_file_id === null
            ? null
            : (keyOf.get(f.source_file_id as number) ?? null),
          false,
        ),
  );
  await db.batch([
    // The retouch photo, with its files (ON DELETE CASCADE); what was
    // merged into it earlier now leads to the merged photo.
    db
      .prepare("UPDATE media SET active_file_id = NULL WHERE id = ?1")
      .bind(opts.from),
    db
      .prepare("UPDATE media_alias SET media_id = ?2 WHERE media_id = ?1")
      .bind(opts.from, opts.into),
    db
      .prepare(`DELETE FROM media WHERE id = ?1 AND ${LIVE_PHOTO}`)
      .bind(opts.from),
    // Its links lead to the merged photo only if they worked (it was
    // public or unlisted): a private photo's id stays a 404.
    db
      .prepare(
        `INSERT INTO media_alias (public_id, media_id, redirect, merged)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(
        from.public_id,
        opts.into,
        from.visibility === "private" ? 0 : 1,
        JSON.stringify(snapshot),
      ),
    // Its files, now the other photo's (the keys' UNIQUE index refuses
    // them if the row above was not deleted: the batch then does nothing).
    ...moved,
    db
      .prepare(
        `UPDATE media SET visibility = ?2, tags = ?3, camera_id = ?4,
           tag_values = ?5,
           active_file_id = CASE WHEN ?6 IS NULL THEN active_file_id
             ELSE (SELECT f.id FROM media_file f WHERE f.storage = 'b2' AND f.object_key = ?6) END,
           updated_at = ${NOW}
         WHERE id = ?1`,
      )
      .bind(
        opts.into,
        set.visibility,
        set.tags,
        set.camera_id,
        set.tag_values,
        show ? snapshot.shownKey : null,
      ),
    contentVersionStatement(db),
  ]);
  return { alias: String(from.public_id) };
};

/**
 * Undo a merge: the alias's photo comes back with its row and files as
 * they were (and its own aliases), and the photo it went into gets back
 * what the merge changed. Refused when that photo was merged into another
 * one since (undo that first).
 */
export const unmergePhoto = async (
  db: D1Database,
  alias: string,
): Promise<{ id: number; path: string }> => {
  const [aliasRows, columns] = await db.batch<Row>([
    db
      .prepare("SELECT media_id, merged FROM media_alias WHERE public_id = ?1")
      .bind(alias),
    db.prepare("SELECT name FROM pragma_table_info('media')"),
  ]);
  const a = (aliasRows.results ?? [])[0];
  if (!a || a.merged === null)
    throw new MergeError("元に戻せる統合がありません");
  const snap = JSON.parse(String(a.merged)) as Snapshot;
  if (a.media_id !== snap.into.id) {
    throw new MergeError(
      "統合先がさらに統合されています。先にそちらを元に戻してください",
    );
  }
  const into = snap.into.id;
  const keys = snap.files.map((f) => String(f.object_key));
  const oldPath = String(snap.photo.path);
  const [lo, hi] = numberedRange(oldPath);
  // Two statements for the path: SQLite does not split an OR over the
  // partial index.
  const [held, idTaken, pathIs, pathIn] = await db.batch<Row>([
    db
      .prepare(
        `SELECT id, object_key, media_id FROM media_file
         WHERE storage = 'b2' AND object_key IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(keys)),
    db.prepare("SELECT 1 FROM media WHERE id = ?1").bind(snap.photo.id),
    db
      .prepare("SELECT path FROM media WHERE trashed_at IS NULL AND path = ?1")
      .bind(oldPath),
    db
      .prepare(
        "SELECT path FROM media WHERE trashed_at IS NULL AND path >= ?1 AND path < ?2",
      )
      .bind(lo, hi),
  ]);
  const heldRows = held.results ?? [];
  if (
    heldRows.length !== keys.length ||
    heldRows.some((r) => r.media_id !== into)
  ) {
    throw new MergeError("ファイルがもう統合先にありません");
  }
  const heldIds = new Set(heldRows.map((r) => r.id as number));
  // A path for it: its own, or the first free numbered one (as restore).
  const taken = new Set(
    [...(pathIs.results ?? []), ...(pathIn.results ?? [])].map((r) =>
      String(r.path),
    ),
  );
  const path = numberedPaths(oldPath).find((p) => !taken.has(p));
  if (!path) throw new MergeError("戻す先の名前がすべて使われています");
  const names = new Set((columns.results ?? []).map((c) => String(c.name)));
  const photo: Row = { ...snap.photo, path, active_file_id: null };
  // Its old id, unless another photo has it now.
  if ((idTaken.results ?? []).length > 0) delete photo.id;
  const cols = Object.keys(photo).filter((c) => names.has(c));
  const original = snap.files.find((f) => f.role === "original");
  if (!original) throw new MergeError("元に戻せる統合がありません");
  const byId = new Map(snap.files.map((f) => [f.id as number, f]));
  const order = sourcesFirst(snap.files);
  const mediaSql = `(SELECT id FROM media WHERE public_id = ?${FILE_COLUMNS.length + 1})`;
  const others = order
    .filter((f) => f.role !== "original")
    .map((f) => {
      const src =
        f.source_file_id === null ? null : byId.get(f.source_file_id as number);
      return insertFile(
        db,
        f,
        mediaSql,
        String(snap.photo.public_id),
        String(f.role),
        src ? String(src.object_key) : null,
        false,
      );
    });
  const intoShown = heldIds.has(snap.into.active_file_id ?? -1)
    ? null
    : snap.into.active_file_id;
  await db.batch([
    // The photo it went into: what the merge changed, and a shown file of
    // its own (one of the files leaving it cannot stay shown).
    db
      .prepare(
        // Each field only if it still has what the merge set: a change
        // made since (e.g. made private again) stays.
        `UPDATE media SET
           visibility = CASE WHEN visibility IS ?8 THEN ?2 ELSE visibility END,
           tags = CASE WHEN tags IS ?9 THEN ?3 ELSE tags END,
           camera_id = CASE WHEN camera_id IS ?10 THEN ?4 ELSE camera_id END,
           tag_values = CASE WHEN tag_values IS ?11 THEN ?5 ELSE tag_values END,
           active_file_id = CASE
             WHEN active_file_id IN (SELECT value FROM json_each(?6))
               THEN (SELECT f.id FROM media_file f WHERE f.id = ?7 AND f.media_id = ?1
                       AND f.status = 'ready' AND f.trashed_at IS NULL)
             ELSE active_file_id END,
           updated_at = ${NOW}
         WHERE id = ?1`,
      )
      .bind(
        into,
        snap.into.visibility,
        snap.into.tags,
        snap.into.camera_id,
        snap.into.tag_values,
        JSON.stringify([...heldIds]),
        intoShown,
        snap.set.visibility,
        snap.set.tags,
        snap.set.camera_id,
        snap.set.tag_values,
      ),
    // The files leave it, copies before what they were made from.
    ...[...order]
      .reverse()
      .map((f) =>
        db
          .prepare(
            "DELETE FROM media_file WHERE media_id = ?1 AND storage = 'b2' AND object_key = ?2",
          )
          .bind(into, String(f.object_key)),
      ),
    db.prepare("DELETE FROM media_alias WHERE public_id = ?1").bind(alias),
    // The photo again (its original's media_file row comes with it, from
    // the trigger), then the rest of its original's row and its other
    // files.
    db
      .prepare(
        `INSERT INTO media (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`,
      )
      .bind(...cols.map((c) => photo[c] ?? null)),
    db
      .prepare(
        `UPDATE media_file SET mime_type = ?2, creator_tool = ?3, xmp_summary = ?4,
           created_at = ?5, metadata_read_at = ?6
         WHERE media_id = (SELECT id FROM media WHERE public_id = ?1) AND role = 'original'`,
      )
      .bind(
        String(snap.photo.public_id),
        original.mime_type ?? null,
        original.creator_tool ?? null,
        original.xmp_summary ?? null,
        original.created_at ?? null,
        original.metadata_read_at ?? null,
      ),
    ...others,
    db
      .prepare(
        `UPDATE media SET active_file_id = (SELECT f.id FROM media_file f
           WHERE f.storage = 'b2' AND f.object_key = ?2 AND f.role = 'edit')
         WHERE public_id = ?1 AND ?2 IS NOT ?3`,
      )
      .bind(
        String(snap.photo.public_id),
        snap.shownKey,
        String(original.object_key),
      ),
    db
      .prepare(
        `UPDATE media_alias SET media_id = (SELECT id FROM media WHERE public_id = ?1)
         WHERE public_id IN (SELECT value FROM json_each(?2)) AND media_id = ?3`,
      )
      .bind(String(snap.photo.public_id), JSON.stringify(snap.aliases), into),
    contentVersionStatement(db),
  ]);
  const back = await db
    .prepare("SELECT id, path FROM media WHERE public_id = ?1")
    .bind(String(snap.photo.public_id))
    .first<{ id: number; path: string }>();
  if (!back) throw new Error("unmerge: the photo did not come back");
  return back;
};

/** A photo of a merge candidate, as the merge page shows it. */
export type CandidatePhoto = {
  id: number;
  publicId: string;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: Visibility;
  timestamp: string | null;
  cameraId: number | null;
  creatorTool: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  /** Retouched versions it has already. */
  edits: number;
};

export type MergeCandidate = {
  original: CandidatePhoto;
  retouch: CandidatePhoto;
  signals: RetouchSignals;
  /** What the merge does unless changed (defaultMerge). */
  defaults: { visibility: Visibility | null; show: boolean };
};

/**
 * Every live photo's id and path, by idx_media_path_live (the same rows
 * the Files view reads for the whole library).
 */
export const NAMES_SQL = `SELECT id, path FROM media
  WHERE trashed_at IS NULL AND status = 'ready' ORDER BY path`;

/** The candidates' details, by id (a few dozen ids at most). */
const DETAILS_SQL = `SELECT m.id, m.public_id, m.file, m.path, m.platform,
    m.visibility, m.timestamp, m.camera_id, m.size, m.width, m.height,
    o.creator_tool,
    (SELECT count(*) FROM media_file e WHERE e.media_id = m.id
       AND e.role = 'edit' AND e.trashed_at IS NULL) AS edits
  FROM media m
  LEFT JOIN media_file o ON o.media_id = m.id AND o.role = 'original'
  WHERE m.id IN (SELECT value FROM json_each(?1))`;

type DetailRow = {
  id: number;
  public_id: string;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: string;
  timestamp: string | null;
  camera_id: number | null;
  size: number | null;
  width: number | null;
  height: number | null;
  creator_tool: string | null;
  edits: number;
};

const toCandidatePhoto = (r: DetailRow): CandidatePhoto => ({
  id: r.id,
  publicId: r.public_id,
  file: r.file,
  path: r.path,
  platform: r.platform,
  visibility: isVisibility(r.visibility) ? r.visibility : "private",
  timestamp: r.timestamp,
  cameraId: r.camera_id,
  creatorTool: r.creator_tool,
  size: r.size,
  width: r.width,
  height: r.height,
  edits: r.edits,
});

/** Pairs of photos where one looks like a retouch of the other. */
export const listMergeCandidates = async (
  db: D1Database,
): Promise<MergeCandidate[]> => {
  const names =
    (await db.prepare(NAMES_SQL).all<{ id: number; path: string }>()).results ??
    [];
  const pairs = findRetouchPairs(names);
  if (pairs.length === 0) return [];
  const ids = [...new Set(pairs.flatMap((p) => [p.original, p.retouch]))];
  const rows =
    (await db.prepare(DETAILS_SQL).bind(JSON.stringify(ids)).all<DetailRow>())
      .results ?? [];
  const byId = new Map(rows.map((r) => [r.id, toCandidatePhoto(r)]));
  const out: MergeCandidate[] = [];
  for (const p of pairs) {
    const original = byId.get(p.original);
    const retouch = byId.get(p.retouch);
    if (!original || !retouch) continue;
    out.push({
      original,
      retouch,
      signals: retouchSignals(
        { timestamp: original.timestamp, camera_id: original.cameraId },
        {
          timestamp: retouch.timestamp,
          camera_id: retouch.cameraId,
          creator_tool: retouch.creatorTool,
        },
      ),
      defaults: defaultMerge(original.visibility, retouch.visibility),
    });
  }
  return out;
};

/** A photo an upload may be a retouch of (the upload panel's hint). */
export type SimilarPhoto = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  signals: RetouchSignals;
};

/**
 * Lookups for the photos an upload of `file` may be a retouch of: for each
 * of its plain stems (uploadBaseStems), the live photos of that stem in
 * its folder, any extension ("<stem>." up to "<stem>/", by
 * idx_media_path_live).
 */
export const similarLookups = (file: string) => {
  const { dir } = splitName(file);
  return uploadBaseStems(file).map((stem) => ({
    stem,
    sql: `SELECT id, file, path, platform, timestamp, camera_id FROM media
          WHERE trashed_at IS NULL AND path >= ?1 AND path < ?2
            AND status = 'ready' AND id <> ?3`,
    lo: `${dir}/${stem}.`,
    hi: `${dir}/${stem}/`,
  }));
};

/**
 * The plainest photo an upload of `file` (now photo `uploadedId`) may be a
 * retouch of, or null: one of the same name with other bytes, or of its
 * name without retouch suffixes, in the same folder.
 */
export const findSimilarPhoto = async (
  db: D1Database,
  file: string,
  uploadedId: number,
  hints: { timestamp: string | null; creatorTool: string | null },
): Promise<SimilarPhoto | null> => {
  const lookups = similarLookups(file);
  const results = await db.batch<{
    id: number;
    file: string;
    path: string;
    platform: MediaPlatform;
    timestamp: string | null;
    camera_id: number | null;
  }>(lookups.map((l) => db.prepare(l.sql).bind(l.lo, l.hi, uploadedId)));
  for (let i = lookups.length - 1; i >= 0; i--) {
    const rows = (results[i].results ?? []).filter(
      (r) => splitName(r.path).stem === lookups[i].stem,
    );
    if (rows.length !== 1) continue;
    const r = rows[0];
    return {
      id: r.id,
      file: r.file,
      path: r.path,
      platform: r.platform,
      signals: retouchSignals(r, {
        timestamp: hints.timestamp,
        camera_id: null,
        creator_tool: hints.creatorTool,
      }),
    };
  }
  return null;
};
