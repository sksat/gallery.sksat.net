// A photo's resized copies and social cards in the R2 bucket
// gallery-media-cache (binding MEDIA_CACHE), as the admin's browser makes
// them: the alternative to the image Worker, which has Image
// Transformations make them (workers/image/src/fill.ts). Both take the
// same claim (../../../shared/resized/claim.ts, media.resized_at) and write
// the same objects (../../../shared/resized/resized.ts), so the Worker
// that serves them cannot tell them apart. Covered by resized.spec.ts on
// the real schema.
//
// The browser maker takes the photos the Worker left to it ('browser:':
// Image Transformations refused the file), and every waiting photo while
// the `setting` row resize_maker is 'browser' (/setting/). It asks for a
// few (claimResized), fetches each one's file (GET /api/resized/<id>/
// source, through AdminImage.object) unless it has it from the upload,
// and posts what it made (storeResized).
//
// Nothing here changes what the public API answers: the Worker looks a
// copy up in the bucket by key, so no content version bump.

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  CARD_FOR_BROWSER,
  CARD_WANTED_PREFIX,
  cardCaptionValue,
  cardWantedKey,
  fitSize,
  isCardPresetName,
  isResizedPreset,
  isResizedType,
  RESIZED_CAPTION,
  RESIZED_PRESET_NAMES,
  RESIZED_SAME_AS,
  removeCopies,
  resizedKey,
  type CardCaption,
  type CardPreset,
  type CopiesBucket,
  type ResizedPreset,
  type ResizedType,
} from "@shared/resized/resized";
import {
  claimCopies,
  claimedSource as sharedClaimedSource,
  finishCopies,
  isMade,
  sourcesOf,
  waitingArgs,
  waitingSql,
  type Maker,
  type SourceRow,
} from "@shared/resized/claim";

export {
  CLAIM_STALE_MS,
  FAILED_RETRY_MS,
  RESIZE_MAKER_KEY,
  RESIZED_DATE,
  resizeMaker,
  waitingArgs,
} from "@shared/resized/claim";

/**
 * Photos per claim. Each means fetching its file (up to ~40 MB) and
 * decoding it in the browser, so a few at a time.
 */
export const RESIZE_BATCH = 3;

/** The largest copy accepted (a w3840 WebP is a few MB at most). */
export const MAX_RESIZED_BYTES = 20 * 1000 * 1000;

/** The file a photo's images are resized from. */
export type ResizeSource = {
  /** media_file.id */
  id: number;
  storage: "b2" | "r2";
  key: string;
  role: string;
};

/** A photo claimed for making its copies in the browser. */
export type ClaimedPhoto = {
  id: number;
  publicId: string;
  /** The claim as written (pass it back with the copies). */
  claim: string;
  source: ResizeSource;
  /**
   * The caption its public `og` card draws (AdminImage.caption), or null
   * when it has none (private) or it could not be asked: then only the
   * badge-only `og-site` card is made.
   */
  caption: CardCaption | null;
};

/** What the public `og` card of a photo says now (AdminImage.caption). */
export type CaptionOf = (publicId: string) => Promise<CardCaption | null>;

const toSource = (r: SourceRow): ResizeSource => ({
  id: r.source_id,
  storage: r.source_storage === "r2" ? "r2" : "b2",
  key: r.source_key,
  role: r.source_role,
});

/**
 * Claim photos for the browser maker: the ones in `ids` it may take (its
 * own uploads), else up to `limit` of any (claim.ts claimCopies).
 */
export const claimResized = async (
  db: D1Database,
  {
    ids,
    limit = RESIZE_BATCH,
    nowMs = Date.now(),
    captionOf = async () => null,
  }: {
    ids?: readonly number[];
    limit?: number;
    nowMs?: number;
    captionOf?: CaptionOf;
  } = {},
): Promise<{ photos: ClaimedPhoto[]; more: boolean }> => {
  const { claim, rows, more } = await claimCopies(db, {
    maker: "browser",
    ids,
    limit,
    nowMs,
  });
  const photos: ClaimedPhoto[] = [];
  for (const r of rows) {
    let caption: CardCaption | null = null;
    try {
      caption = await captionOf(r.public_id);
    } catch (err) {
      // Its `og` card waits for the Worker to ask for it.
      console.error(`caption of ${r.public_id} failed:`, err);
    }
    photos.push({
      id: r.id,
      publicId: r.public_id,
      claim,
      source: toSource(r),
      caption,
    });
  }
  return { photos, more };
};

/**
 * The photo `id` with its file to resize, while `claim` is its claim;
 * null otherwise (claimed again, made, or the file it shows changed).
 */
export const claimedSource = async (
  db: D1Database,
  id: number,
  claim: string,
): Promise<ResizeSource | null> => {
  const row = await sharedClaimedSource(db, id, claim);
  return row ? toSource(row) : null;
};

/** The copies of a photo could not be made here: try again in a day. */
export const failResized = (
  db: D1Database,
  id: number,
  claim: string,
  nowMs: number = Date.now(),
): Promise<boolean> => finishCopies(db, id, claim, "failed", nowMs);

/** One copy as the browser made it. */
export type ResizedItem = {
  preset: ResizedPreset | CardPreset;
  width: number;
  height: number;
  /** The preset whose image this is (stored as an empty alias), or null. */
  sameAs: ResizedPreset | null;
  type: ResizedType;
  /** The image; empty for an alias. */
  bytes: Uint8Array;
  /** An `og` card's caption, as drawn on it. */
  caption?: CardCaption;
};

/** The longest caption line accepted (captionFor makes at most 40). */
const MAX_CAPTION_LINE = 80;

/**
 * A card caption as posted: an object with optional `primary` /
 * `secondary` lines of printable ASCII (and "·", "…", the font subset's
 * two others), or null.
 */
export const parseCardCaption = (raw: unknown): CardCaption | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const out: CardCaption = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k !== "primary" && k !== "secondary") return null;
    if (
      typeof v !== "string" ||
      v === "" ||
      v.length > MAX_CAPTION_LINE ||
      !/^[\x20-\x7E·…]+$/.test(v)
    ) {
      return null;
    }
    out[k] = v;
  }
  return out;
};

const isWebp = (b: Uint8Array) =>
  b.length >= 12 &&
  String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
  String.fromCharCode(...b.subarray(8, 12)) === "WEBP";
const isJpeg = (b: Uint8Array) =>
  b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * The copies of a post (`manifest`: [{ preset, width, height, sameAs,
 * type }], `files`: each image by preset), checked: every resize preset
 * once and the `og-site` card (`og` with `caption`), each image in its
 * format and within its box, each alias pointing at an image of the same
 * size. An error message otherwise.
 */
export const checkResizedItems = (
  manifest: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  /** The `og` card's caption, as drawn (only with an `og` card). */
  caption: unknown = null,
): ResizedItem[] | string => {
  if (!Array.isArray(manifest)) return "manifest must be an array";
  const items: ResizedItem[] = [];
  for (const raw of manifest as unknown[]) {
    if (typeof raw !== "object" || raw === null) return "bad entry";
    const e = raw as Record<string, unknown>;
    const { preset, width, height, sameAs, type } = e;
    if (!isResizedPreset(preset) && !isCardPresetName(preset)) {
      return "unknown preset";
    }
    if (items.some((i) => i.preset === preset)) return `${preset} twice`;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      (width as number) <= 0 ||
      (height as number) <= 0
    ) {
      return `${preset}: bad size`;
    }
    if (sameAs !== null && !isResizedPreset(sameAs)) {
      return `${preset}: bad sameAs`;
    }
    if (!isResizedType(type)) return `${preset}: bad type`;
    const bytes = files.get(preset) ?? new Uint8Array();
    items.push({
      preset,
      width: width as number,
      height: height as number,
      sameAs,
      type,
      bytes,
    });
  }
  if (
    RESIZED_PRESET_NAMES.some((p) => !items.some((i) => i.preset === p)) ||
    !items.some((i) => i.preset === "og-site")
  ) {
    return "a preset is missing";
  }
  const og = items.find((i) => i.preset === "og");
  if (og) {
    const c = parseCardCaption(caption);
    if (!c) return "og: bad caption";
    og.caption = c;
  }
  for (const i of items) {
    if (isCardPresetName(i.preset)) {
      if (i.width !== CARD_WIDTH || i.height !== CARD_HEIGHT) {
        return `${i.preset}: not ${CARD_WIDTH}x${CARD_HEIGHT}`;
      }
      if (i.sameAs !== null || i.type !== "image/jpeg") {
        return `${i.preset}: a card is a JPEG of its own`;
      }
      if (i.bytes.length === 0) return `${i.preset}: no image`;
      if (i.bytes.length > MAX_RESIZED_BYTES) return `${i.preset}: too large`;
      if (!isJpeg(i.bytes)) return `${i.preset}: not image/jpeg`;
      continue;
    }
    // Within its box (the box fits it as it is).
    const fit = fitSize(i.preset, i.width, i.height);
    if (fit.width !== i.width || fit.height !== i.height) {
      return `${i.preset}: larger than its box`;
    }
    if (i.sameAs === null) {
      if (i.bytes.length === 0) return `${i.preset}: no image`;
      if (i.bytes.length > MAX_RESIZED_BYTES) return `${i.preset}: too large`;
      const ok = i.type === "image/webp" ? isWebp(i.bytes) : isJpeg(i.bytes);
      if (!ok) return `${i.preset}: not ${i.type}`;
      continue;
    }
    const target = items.find((t) => t.preset === i.sameAs);
    if (!target || target.sameAs !== null) return `${i.preset}: bad sameAs`;
    if (target.width !== i.width || target.height !== i.height) {
      return `${i.preset}: not the size of ${i.sameAs}`;
    }
    if (i.bytes.length > 0) return `${i.preset}: an alias has no image`;
  }
  return items;
};

/**
 * R2 custom metadata of a stored item: an alias names its preset, an `og`
 * card the caption drawn on it (the Worker compares it with the caption
 * it would draw). The Worker's maker writes the same.
 */
const itemMetadata = (i: ResizedItem): Record<string, string> | undefined =>
  i.sameAs
    ? { [RESIZED_SAME_AS]: i.sameAs }
    : i.preset === "og"
      ? { [RESIZED_CAPTION]: cardCaptionValue(i.caption ?? {}) }
      : undefined;

/** The part of an R2 binding used here (an R2Bucket is one). */
export type ResizedBucket = CopiesBucket & {
  put(
    key: string,
    value: Uint8Array,
    options: {
      httpMetadata: { contentType: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

export type StoreResult =
  | { ok: true; stored: number; removed: number }
  /** The claim is gone (taken again, or the file to resize changed). */
  | { ok: false };

/**
 * Store a claimed photo's copies: the objects first, then the photo marked
 * made, only while `claim` holds and the photo is resized from
 * `sourceFileId`; then the copies of any other file the photo was resized
 * from before are removed. A claim lost in between leaves its objects: a
 * newer claim of the same file writes the same keys, and deleting them
 * could take its copies away (at worst a few objects of a file the photo
 * no longer shows, never served).
 */
export const storeResized = async (
  db: D1Database,
  bucket: ResizedBucket,
  input: {
    id: number;
    claim: string;
    sourceFileId: number;
    items: readonly ResizedItem[];
  },
  nowMs: number = Date.now(),
): Promise<StoreResult> => {
  const row = await sharedClaimedSource(
    db,
    input.id,
    input.claim,
    input.sourceFileId,
  );
  if (!row) return { ok: false };
  for (const i of input.items) {
    await bucket.put(resizedKey(row.public_id, row.source_key, i.preset), i.bytes, {
      httpMetadata: {
        contentType: i.type,
        // Served by the Worker, which sets its own; this is for the record.
        cacheControl: "public, max-age=3600",
      },
      customMetadata: itemMetadata(i),
    });
  }
  if (!(await finishCopies(db, input.id, input.claim, "made", nowMs))) {
    return { ok: false };
  }
  const removed = await removeCopies(bucket, row.public_id, row.source_key);
  // A request for its card (the Worker's) is answered.
  if (input.items.some((i) => i.preset === "og")) {
    await bucket.delete([cardWantedKey(row.public_id)]);
  }
  return { ok: true, stored: input.items.length, removed };
};

/**
 * Remove every copy and card of the photo `id` (完全に削除) and mark it
 * waiting again, so a photo whose B2 delete then fails gets them again if
 * restored.
 */
export const removeResized = async (
  db: D1Database,
  bucket: CopiesBucket,
  id: number,
): Promise<number> => {
  const row = await db
    .prepare("SELECT public_id FROM media WHERE id = ?")
    .bind(id)
    .first<{ public_id: string }>();
  if (!row) return 0;
  const removed = await removeCopies(bucket, row.public_id);
  await bucket.delete([cardWantedKey(row.public_id)]);
  await db
    .prepare("UPDATE media SET resized_at = NULL WHERE id = ?")
    .bind(id)
    .run();
  return removed;
};

/**
 * How many photos `maker` may take now (tests and one-off checks only:
 * the pages never count, to spare D1's daily row reads).
 */
export const countWaitingResized = async (
  db: D1Database,
  nowMs: number = Date.now(),
  maker: Maker = "worker",
  setting: Maker = "worker",
): Promise<number> => {
  const sql = waitingSql(maker, setting);
  if (!sql) return 0;
  return (
    (
      await db
        .prepare(`SELECT COUNT(*) AS c FROM media WHERE ${sql}`)
        .bind(...waitingArgs(nowMs))
        .first<{ c: number }>()
    )?.c ?? 0
  );
};

/** An `og` card the image Worker asked for (its caption changed). */
export type WantedCard = {
  id: number;
  publicId: string;
  /** media.file: the browser reads the photo's stored w3840 by it. */
  file: string;
  /** The file the copies were made from (the card goes under its key). */
  sourceFileId: number;
  caption: CardCaption;
};

/** The part of an R2 binding the card requests are read through. */
export type CardBucket = {
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
    include?: ("customMetadata" | "httpMetadata")[];
  }): Promise<
    {
      objects: { key: string; customMetadata?: Record<string, string> }[];
    } & (
      | { truncated: true; cursor: string }
      | { truncated: false }
    )
  >;
  delete(keys: string[]): Promise<void>;
};

/** Requests read per call (one R2 list, one D1 read). */
export const CARD_BATCH = 10;

/**
 * The `og` cards for the browser maker to make again: the image Worker
 * leaves a marker per photo (CARD_WANTED_PREFIX) when the card it would
 * draw is not stored; its own maker draws those first, and the browser's
 * takes them when the setting says so (setting resize_maker 'browser').
 * Only photos whose copies are made (the card is drawn from the stored
 * w3840); a marker of a photo that is gone, or has no card (private now),
 * is dropped. One page of markers per call (one R2 list and one D1 read,
 * public ids by their UNIQUE index); `cursor` is the next page's (markers
 * that wait for their copies stay, so the next ones are reached past
 * them), null after the last.
 */
export const wantedCards = async (
  db: D1Database,
  bucket: CardBucket,
  captionOf: CaptionOf,
  {
    limit = CARD_BATCH,
    cursor,
    onlyForBrowser = false,
  }: { limit?: number; cursor?: string; onlyForBrowser?: boolean } = {},
): Promise<{ cards: WantedCard[]; cursor: string | null }> => {
  const listed = await bucket.list({
    prefix: CARD_WANTED_PREFIX,
    limit,
    include: ["customMetadata"],
    ...(cursor ? { cursor } : {}),
  });
  const next = listed.truncated ? listed.cursor : null;
  const ids = listed.objects
    // While the image Worker makes the cards, only the ones it left here.
    .filter((o) => !onlyForBrowser || o.customMetadata?.[CARD_FOR_BROWSER])
    .map((o) => o.key.slice(CARD_WANTED_PREFIX.length))
    .filter((id) => /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/.test(id));
  if (ids.length === 0) return { cards: [], cursor: next };
  const rows =
    (
      await db
        .prepare(
          `SELECT m.id, m.public_id, m.file, m.resized_at, src.id AS source_id
           FROM media m
           JOIN media_file shown ON shown.id = COALESCE(m.active_file_id,
             (SELECT o.id FROM media_file o
              WHERE o.media_id = m.id AND o.role = 'original'))
             AND shown.media_id = m.id
           JOIN media_file src ON src.id = COALESCE(
             (SELECT dc.id FROM media_file dc
              WHERE dc.source_file_id = shown.id AND dc.role = 'display'
                AND dc.status = 'ready' AND dc.media_id = m.id
              ORDER BY dc.id DESC LIMIT 1),
             shown.id)
           WHERE m.public_id IN (SELECT value FROM json_each(?1))
             AND m.status = 'ready' AND m.trashed_at IS NULL`,
        )
        .bind(JSON.stringify(ids))
        .all<{
          id: number;
          public_id: string;
          file: string;
          resized_at: string | null;
          source_id: number;
        }>()
    ).results ?? [];
  const out: WantedCard[] = [];
  const drop: string[] = [];
  for (const publicId of ids) {
    const r = rows.find((x) => x.public_id === publicId);
    if (!r) {
      drop.push(publicId);
      continue;
    }
    // Copies not made yet: the card comes with them.
    if (!isMade(r.resized_at)) continue;
    const caption = await captionOf(publicId);
    if (!caption) {
      drop.push(publicId);
      continue;
    }
    out.push({
      id: r.id,
      publicId,
      file: r.file,
      sourceFileId: r.source_id,
      caption,
    });
  }
  if (drop.length > 0) await bucket.delete(drop.map(cardWantedKey));
  return { cards: out, cursor: next };
};

/**
 * Store an `og` card made again (wantedCards), if the photo is still
 * resized from `sourceFileId`, and answer its request. False when it is
 * not (nothing stored; its copies are made again, with the card).
 */
export const storeCard = async (
  db: D1Database,
  bucket: ResizedBucket,
  input: {
    id: number;
    sourceFileId: number;
    caption: CardCaption;
    bytes: Uint8Array;
  },
): Promise<boolean> => {
  const [row] = await sourcesOf(db, [input.id]);
  if (!row || row.source_id !== input.sourceFileId) return false;
  await bucket.put(
    resizedKey(row.public_id, row.source_key, "og"),
    input.bytes,
    {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: {
        [RESIZED_CAPTION]: cardCaptionValue(input.caption),
      },
    },
  );
  await bucket.delete([cardWantedKey(row.public_id)]);
  return true;
};
