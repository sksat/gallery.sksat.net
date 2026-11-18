// Deleting the API Worker's last-good copies that an admin change makes
// wrong (last-good.spec.ts, on the real schema).
//
// While D1 fails, the API Worker serves the copies it kept in the
// `LAST_GOOD` KV namespace (workers/api/src/last-good-store.ts). A photo
// made private, moved, renamed, trashed or with less of its metadata
// shown must not come back from such a copy, so every action that changes
// what the public API answers deletes the affected copies here. Copies
// are written again by the API on its next answer from D1.
//
// Keys are `<generation>:<name>`; the names are the API Worker's
// (`lastGoodName` in workers/api/src/last-good.ts), copied here because
// the two apps share no code: keep them in step. When more than
// MAX_DELETES keys would go (bulk changes, the site defaults, a tag on
// many photos) or a deletion fails, the generation is bumped instead:
// one write that retires every copy (the Free plan allows 1,000 KV writes
// and deletes a day).
//
// Left out on purpose, as they can only show less than D1 now would:
// creating a camera or a folder (nothing public yet), the metadata
// backfill (fills only empty columns), deleting a trashed photo for good
// (its copies went when it was trashed) and incomplete uploads (private).
//
// Never fails an action: errors are logged. Without the binding
// (previews, `pnpm dev`) nothing happens.

/** The part of a KV namespace used here. */
export type LastGoodKV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type Platform =
  | {
      env?: Record<string, unknown>;
      ctx?: { waitUntil(promise: Promise<unknown>): void };
    }
  | undefined;

/** The `LAST_GOOD` binding, or null when it is not bound. */
export const getLastGoodKV = (platform: Platform): LastGoodKV | null =>
  (platform?.env?.LAST_GOOD as LastGoodKV | undefined) ?? null;

/** Same key as the API Worker's GENERATION_KEY. */
export const GENERATION_KEY = "generation";

/** Most keys deleted one by one; past it the generation is bumped. */
export const MAX_DELETES = 40;

/** The API Worker's copy names (workers/api/src/last-good.ts). */
export const lastGoodName = {
  http: (pathname: string) => `http:${pathname.replace(/\/$/, "")}`,
  photo: (publicId: string) => `rpc:photo:${publicId}`,
  pathAccess: (path: string) => `rpc:pathAccess:${path}`,
};

const MEDIA_LIST = lastGoodName.http("/api/media");
const CAMERA_LIST = lastGoodName.http("/api/camera");

/** What an admin change touched. */
export type Stale = {
  /** Photos (media ids): their copies, their cameras' and the lists. */
  photos?: readonly number[];
  /** Photos with this tag (a tag's public flag changed). */
  tag?: string;
  /** Cameras (ids): their pages and the list. */
  cameras?: readonly number[];
  /** A camera whose details changed: also every photo with it. */
  cameraPhotos?: number;
  /** Bucket or display paths whose /img access may have changed. */
  paths?: readonly string[];
  /** Uploads (media ids): only a camera picture at the same file. */
  uploads?: readonly number[];
  /** Names worked out before the change (`staleBefore`). */
  names?: readonly string[];
  /** Everything (the site's metadata defaults). */
  all?: boolean;
};

const json = (v: unknown) => JSON.stringify(v);

/**
 * The copy names `stale` covers, as the database is now, or "all". Old
 * values (a previous path or camera) come from `stale.paths` or from
 * names worked out before the change.
 */
export const staleNames = async (
  db: D1Database,
  stale: Stale,
): Promise<string[] | "all"> => {
  if (stale.all) return "all";
  const names = new Set<string>(stale.names ?? []);
  const photos = [...(stale.photos ?? [])];
  const cameras = [...(stale.cameras ?? [])];
  if (stale.cameraPhotos !== undefined) cameras.push(stale.cameraPhotos);

  const statements: D1PreparedStatement[] = [];
  if (stale.tag !== undefined) {
    statements.push(
      db
        .prepare(
          `SELECT id FROM media WHERE json_valid(tags)
             AND EXISTS (SELECT 1 FROM json_each(media.tags) j WHERE j.value = ?1)`,
        )
        .bind(stale.tag),
    );
  }
  if (stale.cameraPhotos !== undefined) {
    statements.push(
      db
        .prepare("SELECT id FROM media WHERE camera_id = ?1")
        .bind(stale.cameraPhotos),
    );
  }
  if (statements.length > 0) {
    for (const r of await db.batch<{ id: number }>(statements)) {
      for (const row of r.results ?? []) photos.push(row.id);
    }
  }

  const [photoRows, cameraRows, uploadRows] = await db.batch<{
    public_id?: string;
    path?: string;
    slug?: string | null;
    file?: string;
  }>([
    db
      .prepare(
        `SELECT m.public_id, m.path, c.slug FROM media m
           LEFT JOIN camera c ON c.id = m.camera_id
         WHERE m.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(json(photos)),
    db
      .prepare(
        "SELECT slug FROM camera WHERE id IN (SELECT value FROM json_each(?1))",
      )
      .bind(json(cameras)),
    // A new photo is private; it can only take an /img path from a camera
    // picture that has the same bucket file.
    db
      .prepare(
        `SELECT m.file FROM media m WHERE m.id IN (SELECT value FROM json_each(?1))
           AND EXISTS (SELECT 1 FROM camera_image c WHERE c.file = m.file)`,
      )
      .bind(json(stale.uploads ?? [])),
  ]);
  for (const r of photoRows.results ?? []) {
    if (r.public_id) {
      names.add(lastGoodName.http(`/api/media/${r.public_id}`));
      names.add(lastGoodName.photo(r.public_id));
    }
    if (r.path) names.add(lastGoodName.pathAccess(r.path));
    if (r.slug) names.add(lastGoodName.http(`/api/camera/${r.slug}`));
  }
  for (const r of cameraRows.results ?? []) {
    if (r.slug) names.add(lastGoodName.http(`/api/camera/${r.slug}`));
  }
  for (const r of uploadRows.results ?? []) {
    if (r.file) names.add(lastGoodName.pathAccess(r.file));
  }
  for (const p of stale.paths ?? []) names.add(lastGoodName.pathAccess(p));
  if (photos.length > 0 || cameras.length > 0 || stale.tag !== undefined) {
    names.add(MEDIA_LIST);
    names.add(CAMERA_LIST);
  }
  return [...names].sort();
};

/**
 * Retire every copy: the API Worker reads only the new generation's. A
 * fresh random value, not old + 1: KV reads may be a minute old, and two
 * bumps from the same stale value would write the same generation (the
 * second retiring nothing).
 */
export const bumpGeneration = async (kv: LastGoodKV): Promise<void> => {
  await kv.put(GENERATION_KEY, crypto.randomUUID().replace(/-/g, ""));
};

/**
 * Delete the copies `names` (or all of them). Bumps the generation when
 * there are too many or a deletion fails. Never rejects.
 */
export const dropCopies = async (
  kv: LastGoodKV,
  names: readonly string[] | "all",
): Promise<void> => {
  try {
    if (names === "all" || names.length > MAX_DELETES) {
      await bumpGeneration(kv);
      return;
    }
    if (names.length === 0) return;
    const generation = (await kv.get(GENERATION_KEY)) ?? "0";
    const results = await Promise.allSettled(
      names.map((n) => kv.delete(`${generation}:${n}`)),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      console.error(
        "last-good: delete failed, bumping the generation:",
        failed.reason,
      );
      await bumpGeneration(kv);
    }
  } catch (err) {
    // E.g. the generation could not be read: retire everything rather
    // than leave a copy that may show what was just hidden.
    console.error("last-good: invalidation failed, bumping:", err);
    await bumpGeneration(kv).catch((e) =>
      console.error("last-good: bump failed:", e),
    );
  }
};

/**
 * The names `stale` covers before a change that moves them (a photo's
 * camera, a camera's slug), to pass as `names` afterwards. Empty without
 * the binding (and on error).
 */
export const staleBefore = async (
  platform: Platform,
  db: D1Database,
  stale: Stale,
): Promise<string[]> => {
  if (!getLastGoodKV(platform)) return [];
  try {
    const names = await staleNames(db, stale);
    return names === "all" ? [] : names;
  } catch (err) {
    console.error("last-good: reading the names before a change failed:", err);
    return [];
  }
};

/**
 * After an admin change: delete the copies it made wrong, in the
 * background when the platform has waitUntil. Never rejects.
 */
export const invalidateLastGood = async (
  platform: Platform,
  db: D1Database,
  stale: Stale,
): Promise<void> => {
  const kv = getLastGoodKV(platform);
  if (!kv) return;
  const work = (async () => {
    try {
      await dropCopies(kv, await staleNames(db, stale));
    } catch (err) {
      // The names could not be read: retire everything rather than leave
      // a copy that may show what was just hidden.
      console.error("last-good: names failed, bumping the generation:", err);
      await bumpGeneration(kv).catch((e) =>
        console.error("last-good: bump failed:", e),
      );
    }
  })();
  const ctx = platform?.ctx;
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
};

/** Stale of a move plan (moveItems): the photos and their old paths. */
export const movedStale = (plan: {
  photos: readonly { id: number; from: string }[];
}): Stale => ({
  photos: plan.photos.map((p) => p.id),
  paths: plan.photos.map((p) => p.from),
});
