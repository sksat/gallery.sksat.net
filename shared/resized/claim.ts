// Which photos still need their resized copies and cards, and the one
// claim both makers take before making them (migration 0018,
// media.resized_at): the image Worker, which has Image Transformations
// make them (from its cron and at upload, through the API Worker's RPCs),
// and the admin's browser, the alternative (admin/src/lib/resized.ts).
// Shared so that the two cannot disagree on what a claim is. Plain TS over
// a D1 binding; covered by admin/src/lib/resized.spec.ts on the real
// schema.
//
// media.resized_at:
//   NULL                waiting (never made, or the file to resize changed)
//   <ISO time>          made; waiting again once older than RESIZED_DATE
//   'making:<time>'     claimed; taken again after CLAIM_STALE_MS
//   'failed:<time>'     could not be made now (the quota, an outage, a
//                       browser out of memory); waiting again after a day
//   'browser:<time>'    Image Transformations cannot make it (a file it
//                       refuses): only the browser maker takes it
//
// The `setting` row resize_maker says which maker takes the waiting
// photos: 'worker' (the default) or 'browser'. The browser maker always
// takes the 'browser:' ones.

export type Maker = "worker" | "browser";

/**
 * The part of a D1 binding used here (a D1Database is one; spelled out so
 * that the gallery, which has no Workers types, can check this file).
 */
type Statement = {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results?: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
export type ClaimDb = { prepare(sql: string): Statement };

export const RESIZE_MAKER_KEY = "resize_maker";

/**
 * Copies made before this are made again (bump it when the way they are
 * made changes, e.g. quality or format; no migration).
 */
export const RESIZED_DATE = "2026-11-20T00:00:00.000Z";

/** A claim older than this is taken to be abandoned. */
export const CLAIM_STALE_MS = 30 * 60 * 1000;

/** A photo whose copies could not be made is tried again after this. */
export const FAILED_RETRY_MS = 24 * 60 * 60 * 1000;

export const CLAIM = "making:";
export const FAILED = "failed:";
export const BROWSER = "browser:";

/** A listed photo, kept off its indexes (admin backfill.ts LIVE). */
const LIVE = "+status = 'ready' AND +trashed_at IS NULL";

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Waiting photos (?1 RESIZED_DATE, ?2 the cut-off for claims, ?3 for
 * failures). Ranges only, so idx_media_resized_at answers each term: made
 * times start with a digit, below 'browser:', 'failed:' and 'making:'.
 */
const WAITING = `(resized_at IS NULL
  OR resized_at < ?1
  OR (resized_at >= '${CLAIM}' AND resized_at < ?2)
  OR (resized_at >= '${FAILED}' AND resized_at < ?3))`;

/** Left for the browser maker ('browser:' + any time; ';' follows ':'). */
const FOR_BROWSER = `(resized_at >= '${BROWSER}' AND resized_at < 'browser;')`;

/**
 * What `maker` may claim while the site's setting is `setting`, in SQL
 * (bind waitingArgs); null for nothing.
 */
export const waitingSql = (maker: Maker, setting: Maker): string | null => {
  if (maker === "worker") {
    return setting === "worker" ? `${WAITING} AND ${LIVE}` : null;
  }
  return setting === "browser"
    ? `(${WAITING} OR ${FOR_BROWSER}) AND ${LIVE}`
    : `${FOR_BROWSER} AND ${LIVE}`;
};

export const waitingArgs = (nowMs: number) => [
  RESIZED_DATE,
  CLAIM + iso(nowMs - CLAIM_STALE_MS),
  FAILED + iso(nowMs - FAILED_RETRY_MS),
];

/** resized_at for copies made now (never before RESIZED_DATE). */
export const madeStamp = (nowMs: number): string => {
  const now = iso(nowMs);
  return now > RESIZED_DATE ? now : RESIZED_DATE;
};

/** Whether `resized_at` says the copies are made (and current). */
export const isMade = (resizedAt: string | null): boolean =>
  resizedAt !== null && /^\d/.test(resizedAt) && resizedAt >= RESIZED_DATE;

/** The site's setting (one single-row read; a JSON string, "worker"). */
export const resizeMaker = async (db: ClaimDb): Promise<Maker> =>
  (
    await db
      .prepare("SELECT value FROM setting WHERE key = ?")
      .bind(RESIZE_MAKER_KEY)
      .first<{ value: string }>()
  )?.value === JSON.stringify("browser")
    ? "browser"
    : "worker";

/** Set the site's maker. */
export const setResizeMaker = async (
  db: ClaimDb,
  maker: Maker,
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO setting (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = ?2,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(RESIZE_MAKER_KEY, JSON.stringify(maker))
    .run();
};

/**
 * The file an image of the photo `m` is resized from: the file it shows
 * (active_file_id, NULL = the original), or that file's newest ready
 * display copy (admin src/lib/media-file.ts IMAGE_SOURCE_JOINS, the API
 * Worker's SOURCE_JOINS).
 */
const SOURCE_JOINS = `
  JOIN media_file shown ON shown.id = COALESCE(m.active_file_id,
    (SELECT o.id FROM media_file o
     WHERE o.media_id = m.id AND o.role = 'original'))
    AND shown.media_id = m.id
  JOIN media_file src ON src.id = COALESCE(
    (SELECT dc.id FROM media_file dc
     WHERE dc.source_file_id = shown.id AND dc.role = 'display'
       AND dc.status = 'ready' AND dc.media_id = m.id
     ORDER BY dc.id DESC LIMIT 1),
    shown.id)`;

/** The photos `?1` (JSON ids) with their file to resize and state. */
export const PHOTO_SOURCE_SQL = `SELECT m.id, m.public_id, m.visibility,
    m.width, m.height, m.resized_at,
    src.id AS source_id, src.storage AS source_storage,
    src.object_key AS source_key, src.role AS source_role
  FROM media m ${SOURCE_JOINS}
  WHERE m.id IN (SELECT value FROM json_each(?1))`;

export type SourceRow = {
  id: number;
  public_id: string;
  visibility: string;
  /** The photo's size as displayed (0016); null when unknown. */
  width: number | null;
  height: number | null;
  resized_at: string | null;
  source_id: number;
  source_storage: string;
  source_key: string;
  source_role: string;
};

export const sourcesOf = async (
  db: ClaimDb,
  ids: readonly number[],
): Promise<SourceRow[]> =>
  ids.length === 0
    ? []
    : ((
        await db
          .prepare(PHOTO_SOURCE_SQL)
          .bind(JSON.stringify(ids))
          .all<SourceRow>()
      ).results ?? []);

/**
 * Claim photos for `maker`: the ones in `ids` that it may take (a photo
 * just uploaded), else up to `limit` of any, public ones first (what
 * visitors see), then the newest. One indexed claim. `rows` in claim
 * order with their files; a claimed photo with no file to resize (no
 * media_file row) is marked failed and left out.
 */
export const claimCopies = async (
  db: ClaimDb,
  {
    maker,
    ids,
    limit,
    nowMs = Date.now(),
  }: {
    maker: Maker;
    ids?: readonly number[];
    limit: number;
    nowMs?: number;
  },
): Promise<{ claim: string; rows: SourceRow[]; more: boolean }> => {
  const claim = CLAIM + iso(nowMs);
  const waiting = waitingSql(maker, await resizeMaker(db));
  if (!waiting || limit <= 0) return { claim, rows: [], more: false };
  const only = ids
    ? " AND id IN (SELECT value FROM json_each(?6))"
    : " AND ?6 IS NULL";
  const claimed =
    (
      await db
        .prepare(
          `UPDATE media SET resized_at = ?4
           WHERE id IN (SELECT id FROM media
                        WHERE ${waiting}${only}
                        ORDER BY CASE visibility WHEN 'public' THEN 0
                                   WHEN 'unlisted' THEN 1 ELSE 2 END, id DESC
                        LIMIT ?5)
             AND ${waiting}
           RETURNING id`,
        )
        .bind(
          ...waitingArgs(nowMs),
          claim,
          limit,
          ids ? JSON.stringify(ids) : null,
        )
        .all<{ id: number }>()
    ).results ?? [];
  const byId = new Map(
    (
      await sourcesOf(
        db,
        claimed.map((r) => r.id),
      )
    ).map((r) => [r.id, r]),
  );
  const rows: SourceRow[] = [];
  for (const { id } of claimed) {
    const r = byId.get(id);
    if (r) rows.push(r);
    else await finishCopies(db, id, claim, "failed", nowMs);
  }
  return { claim, rows, more: claimed.length === limit };
};

/**
 * End a claim: the copies are made, could not be made now ('failed', in
 * a day again), or cannot be made by Image Transformations ('browser').
 * Only while `claim` holds; whether it did.
 */
export const finishCopies = async (
  db: ClaimDb,
  id: number,
  claim: string,
  outcome: "made" | "failed" | "browser",
  nowMs: number = Date.now(),
): Promise<boolean> => {
  const value =
    outcome === "made"
      ? madeStamp(nowMs)
      : (outcome === "failed" ? FAILED : BROWSER) + iso(nowMs);
  const r = await db
    .prepare(
      "UPDATE media SET resized_at = ?3 WHERE id = ?1 AND resized_at = ?2",
    )
    .bind(id, claim, value)
    .run();
  return (r.meta?.changes ?? 0) > 0;
};

/**
 * The photo `id` with its file to resize while `claim` holds and it is
 * still resized from `sourceFileId` (when given); null otherwise.
 */
export const claimedSource = async (
  db: ClaimDb,
  id: number,
  claim: string,
  sourceFileId?: number,
): Promise<SourceRow | null> => {
  const [row] = await sourcesOf(db, [id]);
  if (!row || row.resized_at !== claim) return null;
  if (sourceFileId !== undefined && row.source_id !== sourceFileId) return null;
  return row;
};
