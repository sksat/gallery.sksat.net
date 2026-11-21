/**
 * Making the photos' resized copies and cards once, with Image
 * Transformations, and keeping them in the R2 bucket gallery-media-cache
 * (MEDIA_CACHE), which the public handler serves first (stored.ts). Run by
 * the cron (`scheduled`, every 5 minutes, wrangler.jsonc) and, for a photo
 * just uploaded, by AdminImage.makeCopies. Tested in fill.spec.ts.
 *
 * Which photos: the API Worker's claim (claimCopies, the shared claim of
 * ../../../shared/resized/claim.ts, media.resized_at), the same the
 * admin's browser maker takes, so the two never make the same photo at
 * once. This Worker has no D1 binding: it claims and finishes through the
 * API's RPCs, which touch media.resized_at only.
 *
 * Each preset is the public handler's own transformation (render.ts, the
 * same options and source URL): WebP for the resize presets (what
 * browsers are served anyway), JPEG cards with the badge and, on `og`,
 * the caption the handler would draw now, stored with it as metadata.
 * Presets the photo already fits (its size from the API) are stored as
 * empty aliases (`same-as`), with no transformation.
 *
 * Limits of the Free plan, per invocation: 50 subrequests to the
 * internet (each transformation is one; R2 and the API's RPCs count
 * toward Cloudflare's separate 1,000) and 10 ms of CPU (bodies are
 * streamed into R2 when their length is known, never decoded).
 * RUN_TRANSFORMS keeps a run well under 50; a photo takes at most 8
 * (6 presets, og-site, og) and is started only when they fit.
 */
import {
  cardCaptionValue,
  cardWantedKey,
  CARD_FOR_BROWSER,
  CARD_WANTED_PREFIX,
  planResized,
  RESIZED_CAPTION,
  RESIZED_PRESET_NAMES,
  RESIZED_SAME_AS,
  removeCopies,
  resizedKey,
  type ResizedPreset,
} from "../../../shared/resized/resized";
import { captionFor, type CaptionSource } from "./caption";
import type { OriginEnv } from "./origin";
import { render } from "./render";
import {
  parseFilePath,
  PUBLIC_ID_RE,
  transformFailed,
  type PresetName,
} from "./request";

/** Transformations one invocation may ask for (Free: 50 subrequests). */
export const RUN_TRANSFORMS = 40;

/** The most one photo takes: 6 presets, og-site and og. */
export const PHOTO_TRANSFORMS = 8;

/** Photos claimed per run (most take 7–8 transformations). */
export const RUN_PHOTOS = 5;

/** og card requests looked at per run. */
export const RUN_CARDS = 10;

/** Listings of card requests read per run at most (1,000 each). */
export const CARD_PAGES = 5;

/** Where today's count of transformations is kept (UTC date). */
export const dayKey = (nowMs: number): string =>
  `state/transforms/${new Date(nowMs).toISOString().slice(0, 10)}`;

/** A photo to make the copies of (the API's CopiesJob). */
export type CopiesJob = {
  id: number;
  publicId: string;
  claim: string;
  source: { storage: "b2" | "r2"; key: string };
  width: number | null;
  height: number | null;
  photo: (CaptionSource & { id: string; source?: { key: string } }) | null;
};

/** The API Worker's RPCs this needs. */
export interface CopiesApi {
  claimCopies(limit: number, ids?: number[]): Promise<CopiesJob[]>;
  finishCopies(
    id: number,
    claim: string,
    outcome: "made" | "failed" | "browser",
  ): Promise<boolean>;
  copiesMaker(): Promise<"worker" | "browser">;
  photo(publicId: string): Promise<
    | (CaptionSource & {
        id: string;
        file: string;
        source?: { storage: string; key: string };
      })
    | null
  >;
}

export type FillEnv = OriginEnv & {
  API: CopiesApi;
  MEDIA_CACHE?: R2Bucket;
  /** Where the card assets are (the public site), e.g. https://gallery.sksat.net */
  PUBLIC_ORIGIN?: string;
  /**
   * The most transformations a day (UTC), to spread the first backfill
   * over months; empty or unset for no cap. Approximate: a cron run and an
   * upload that overlap may both spend what is left, so a day can go over
   * by one photo's (8).
   */
  RESIZE_DAILY_CAP?: string;
};

/** Why a transformation failed: the quota (or an outage) or the file. */
type Failure = "later" | "file";

/**
 * Image Transformations' answer: a 2xx without `err=` is an image. Its
 * quota (9422) and rate limits, or a 5xx, are worth trying later; any
 * other error is the file's (one it will not transform).
 */
const failureOf = (res: Response): Failure | null => {
  const resized = res.headers.get("Cf-Resized");
  if (!transformFailed(res.status, resized)) return null;
  if (
    res.status === 429 ||
    res.status >= 500 ||
    /err=9422\b/.test(resized ?? "")
  ) {
    return "later";
  }
  return "file";
};

/** Put a transformation's body: streamed when its length is known. */
const putBody = async (
  bucket: R2Bucket,
  key: string,
  res: Response,
  customMetadata?: Record<string, string>,
): Promise<void> => {
  const contentType = res.headers.get("Content-Type") ?? "image/webp";
  const length = Number(res.headers.get("Content-Length"));
  const body =
    res.body &&
    Number.isInteger(length) &&
    length > 0 &&
    typeof FixedLengthStream !== "undefined"
      ? res.body.pipeThrough(new FixedLengthStream(length))
      : await res.arrayBuffer();
  await bucket.put(key, body, {
    httpMetadata: { contentType },
    ...(customMetadata ? { customMetadata } : {}),
  });
};

/** Every preset with an image of its own when the size is unknown. */
const planFor = (job: CopiesJob) =>
  job.width && job.height
    ? planResized(job.width, job.height)
    : RESIZED_PRESET_NAMES.map((preset) => ({
        preset,
        sameAs: null as ResizedPreset | null,
      }));

/** What making one photo came to. */
export type MadeResult = {
  outcome: "made" | Failure | "lost";
  transforms: number;
};

/**
 * Make one claimed photo's copies and cards and finish its claim. Stops
 * at the first failure: 'later' (the quota: the claim is finished as
 * failed, tried again in a day) or 'file' (left to the admin's browser).
 */
export const makeCopies = async (
  env: FillEnv,
  bucket: R2Bucket,
  job: CopiesJob,
  /** Counts every transformation asked for, also when this throws. */
  tally: { n: number } = { n: 0 },
): Promise<MadeResult> => {
  let transforms = 0;
  const origin = env.PUBLIC_ORIGIN ?? "https://gallery.sksat.net";
  const key =
    job.source.storage === "b2" ? parseFilePath(job.source.key) : null;
  const finish = async (outcome: "made" | Failure): Promise<MadeResult> => {
    const held = await env.API.finishCopies(
      job.id,
      job.claim,
      outcome === "made" ? "made" : outcome === "later" ? "failed" : "browser",
    );
    return { outcome: held ? outcome : "lost", transforms };
  };
  // A key this Worker cannot fetch (R2, an old name outside the rules).
  if (!key || !PUBLIC_ID_RE.test(job.publicId)) return finish("file");
  const keyOf = (preset: PresetName) =>
    resizedKey(job.publicId, key, preset as ResizedPreset);
  /** One transformation (never the handler's badge-only retry). */
  const one = async (
    preset: PresetName,
    accept: string | null,
    caption = {},
    meta?: Record<string, string>,
  ): Promise<Failure | null> => {
    const { upstream } = await render(
      env,
      key,
      preset,
      accept,
      origin,
      caption,
      {
        retry: false,
      },
    );
    transforms += 1;
    tally.n += 1;
    const failed = failureOf(upstream);
    if (failed) {
      await upstream.body?.cancel().catch(() => {});
      return failed;
    }
    await putBody(bucket, keyOf(preset), upstream, meta);
    return null;
  };
  for (const p of planFor(job)) {
    if (p.sameAs) {
      await bucket.put(keyOf(p.preset), new Uint8Array(), {
        customMetadata: { [RESIZED_SAME_AS]: p.sameAs },
      });
      continue;
    }
    const failed = await one(p.preset, "image/webp");
    if (failed) return finish(failed);
  }
  const siteFailed = await one("og-site", null);
  if (siteFailed) return finish(siteFailed);
  if (job.photo) {
    const caption = captionFor(job.photo);
    const failed = await one("og", null, caption, {
      [RESIZED_CAPTION]: cardCaptionValue(caption),
    });
    if (failed === "later") return finish(failed);
    if (failed) {
      // Image Transformations would not draw this caption: the copies are
      // made, and the card is left to the admin's browser (the handler
      // answers with og-site meanwhile).
      await bucket.put(cardWantedKey(job.publicId), new Uint8Array(), {
        customMetadata: { [CARD_FOR_BROWSER]: "1" },
      });
    } else {
      await bucket.delete(cardWantedKey(job.publicId));
    }
  }
  const result = await finish("made");
  // The copies of a file the photo no longer shows.
  if (result.outcome === "made") await removeCopies(bucket, job.publicId, key);
  return result;
};

/**
 * Remake the `og` cards the public handler asked for (stored.ts
 * wantCard): a marker per photo whose card is missing or shows another
 * caption. One transformation each.
 */
export const remakeCards = async (
  env: FillEnv,
  bucket: R2Bucket,
  budget: number,
): Promise<{ transforms: number; stop: boolean }> => {
  let transforms = 0;
  let tried = 0;
  // The requests with their metadata, 1,000 a listing (one Class A
  // operation each); the ones left to the browser are passed over, and
  // later pages are read until there is work (at most CARD_PAGES).
  const pending: R2Object[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < CARD_PAGES; page++) {
    const listed = await bucket.list({
      prefix: CARD_WANTED_PREFIX,
      limit: 1000,
      include: ["customMetadata"],
      ...(cursor ? { cursor } : {}),
    } as R2ListOptions);
    pending.push(
      ...listed.objects.filter((o) => !o.customMetadata?.[CARD_FOR_BROWSER]),
    );
    cursor = listed.truncated ? listed.cursor : undefined;
    if (!cursor || pending.length >= RUN_CARDS) break;
  }
  const origin = env.PUBLIC_ORIGIN ?? "https://gallery.sksat.net";
  for (const o of pending) {
    if (tried >= RUN_CARDS || transforms + 1 > budget) break;
    tried++;
    const publicId = o.key.slice(CARD_WANTED_PREFIX.length);
    const photo = PUBLIC_ID_RE.test(publicId)
      ? await env.API.photo(publicId)
      : null;
    const source =
      photo?.source ?? (photo ? { storage: "b2", key: photo.file } : null);
    const key = source?.storage === "b2" ? parseFilePath(source.key) : null;
    if (!photo || !key) {
      // Gone, private, or nothing this Worker can draw from.
      await bucket.delete(o.key);
      continue;
    }
    const caption = captionFor(photo);
    const { upstream } = await render(env, key, "og", null, origin, caption, {
      retry: false,
    });
    transforms += 1;
    const failed = failureOf(upstream);
    if (failed) {
      await upstream.body?.cancel().catch(() => {});
      if (failed === "later") return { transforms, stop: true };
      // Image Transformations will not draw it: left to the admin's
      // browser (passed over here, so it never holds up the others).
      await bucket.put(o.key, new Uint8Array(), {
        customMetadata: { [CARD_FOR_BROWSER]: "1" },
      });
      continue;
    }
    await putBody(bucket, resizedKey(publicId, key, "og"), upstream, {
      [RESIZED_CAPTION]: cardCaptionValue(caption),
    });
    await bucket.delete(o.key);
  }
  return { transforms, stop: false };
};

/**
 * Today's transformations so far, and how many more today allows: the sum
 * of the day's records, one object per run (countDay), so runs that
 * overlap (the cron and an upload) never overwrite each other's count.
 */
const dayBudget = async (
  env: FillEnv,
  bucket: R2Bucket,
  nowMs: number,
): Promise<{ used: number; left: number }> => {
  const cap = Number(env.RESIZE_DAILY_CAP);
  if (!env.RESIZE_DAILY_CAP || !Number.isFinite(cap) || cap < 0) {
    return { used: 0, left: Infinity };
  }
  let used = 0;
  let cursor: string | undefined;
  do {
    // `include` returns each record's count with the listing (the
    // installed workers-types do not know the option yet).
    const page = await bucket.list({
      prefix: `${dayKey(nowMs)}/`,
      include: ["customMetadata"],
      ...(cursor ? { cursor } : {}),
    } as R2ListOptions);
    for (const o of page.objects) {
      used += Number(o.customMetadata?.count ?? 0) || 0;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { used, left: Math.max(0, cap - used) };
};

/** Record this run's transformations (an object of its own). */
const countDay = async (
  env: FillEnv,
  bucket: R2Bucket,
  nowMs: number,
  added: number,
): Promise<void> => {
  if (!env.RESIZE_DAILY_CAP || added === 0) return;
  await bucket.put(
    `${dayKey(nowMs)}/${crypto.randomUUID()}`,
    new Uint8Array(),
    {
      customMetadata: { count: String(added) },
    },
  );
};

/**
 * One cron run: the og cards asked for, then a few waiting photos, within
 * RUN_TRANSFORMS and the daily cap. Nothing while the site makes them in
 * the browser (setting resize_maker). Returns the transformations used.
 */
export const fillCopies = async (
  env: FillEnv,
  nowMs: number = Date.now(),
): Promise<number> => {
  const bucket = env.MEDIA_CACHE;
  if (!bucket) return 0;
  if ((await env.API.copiesMaker()) !== "worker") return 0;
  const day = await dayBudget(env, bucket, nowMs);
  let budget = Math.min(RUN_TRANSFORMS, day.left);
  // Every transformation asked for, counted even if the run throws.
  const tally = { n: 0 };
  try {
    const cards = await remakeCards(env, bucket, budget);
    tally.n += cards.transforms;
    budget -= cards.transforms;
    if (cards.stop) return tally.n;
    const photos = Math.min(RUN_PHOTOS, Math.floor(budget / PHOTO_TRANSFORMS));
    if (photos <= 0) return tally.n;
    const jobs = await env.API.claimCopies(photos);
    for (const job of jobs) {
      const made = await makeCopies(env, bucket, job, tally);
      // The quota: the rest of the batch waits (their claims expire).
      if (made.outcome === "later") break;
    }
    return tally.n;
  } finally {
    await countDay(env, bucket, nowMs, tally.n);
  }
};

/**
 * Make the copies of the photo `id` now (an upload just completed; the
 * admin asks, AdminImage.makeCopies), if it is waiting and the site makes
 * them here. Within one invocation's limits: a single photo.
 */
export const makeCopiesNow = async (
  env: FillEnv,
  id: number,
  nowMs: number = Date.now(),
): Promise<MadeResult | null> => {
  const bucket = env.MEDIA_CACHE;
  if (!bucket) return null;
  const day = await dayBudget(env, bucket, nowMs);
  if (day.left < PHOTO_TRANSFORMS) return null;
  const [job] = await env.API.claimCopies(1, [id]);
  if (!job) return null;
  const tally = { n: 0 };
  try {
    return await makeCopies(env, bucket, job, tally);
  } finally {
    await countDay(env, bucket, nowMs, tally.n);
  }
};
