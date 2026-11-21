// Resized copies of a photo made once in the admin's browser and kept in
// the R2 bucket `gallery-media-cache` (binding MEDIA_CACHE in the image Worker and
// the admin), so serving a photo does not use Cloudflare Image
// Transformations (5,000 unique transformations a month on the Free plan).
// Used by the admin (making and storing them, admin/src/lib/resized.ts) and
// the image Worker (serving them, workers/image/src/index.ts); plain TS.

/**
 * The resize presets of the image Worker (workers/image/src/request.ts
 * PRESETS, without the og cards, which are drawn by Image Transformations):
 * a box the photo is scaled down to fit, never up (`fit: "scale-down"`).
 * resized.spec.ts checks they match.
 */
export const RESIZED_PRESETS = {
  h240: { height: 240 },
  h480: { height: 480 },
  w1200: { width: 1200 },
  w1920: { width: 1920 },
  w2560: { width: 2560 },
  w3840: { width: 3840 },
} as const satisfies Record<string, { width?: number; height?: number }>;

export type ResizedPreset = keyof typeof RESIZED_PRESETS;

/** The presets, smallest box first (the order of `planResized`). */
export const RESIZED_PRESET_NAMES = Object.keys(
  RESIZED_PRESETS,
) as ResizedPreset[];

export const isResizedPreset = (s: unknown): s is ResizedPreset =>
  typeof s === "string" &&
  Object.prototype.hasOwnProperty.call(RESIZED_PRESETS, s);

/** The formats a copy is stored in (WebP; JPEG where it cannot be encoded). */
export const RESIZED_TYPES = ["image/webp", "image/jpeg"] as const;
export type ResizedType = (typeof RESIZED_TYPES)[number];

export const isResizedType = (s: unknown): s is ResizedType =>
  (RESIZED_TYPES as readonly unknown[]).includes(s);

/**
 * R2 custom metadata of a copy that is the same image as another preset's
 * (a photo smaller than the box: see planResized). Its value is that
 * preset; the object itself is empty.
 */
export const RESIZED_SAME_AS = "same-as";

/**
 * The size `preset` gives a `width` x `height` image: scaled down to fit
 * its box, keeping the aspect ratio, never enlarged (Image
 * Transformations' scale-down).
 */
export const fitSize = (
  preset: ResizedPreset,
  width: number,
  height: number,
): { width: number; height: number } => {
  const box: { width?: number; height?: number } = RESIZED_PRESETS[preset];
  const scale = Math.min(
    1,
    box.width ? box.width / width : Infinity,
    box.height ? box.height / height : Infinity,
  );
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export type ResizedPlanItem = {
  preset: ResizedPreset;
  width: number;
  height: number;
  /**
   * Null: an image of its own. Else the (earlier) preset whose image is
   * the same size, which this preset is stored as an alias of: every box
   * the photo already fits gives the photo at its own size, made once.
   */
  sameAs: ResizedPreset | null;
};

/** What to make for a photo of `width` x `height` (as displayed). */
export const planResized = (
  width: number,
  height: number,
): ResizedPlanItem[] => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError(`not an image size: ${width}x${height}`);
  }
  const bySize = new Map<string, ResizedPreset>();
  return RESIZED_PRESET_NAMES.map((preset) => {
    const size = fitSize(preset, width, height);
    const k = `${size.width}x${size.height}`;
    const first = bySize.get(k);
    if (!first) bySize.set(k, preset);
    return { preset, ...size, sameAs: first ?? null };
  });
};

/**
 * The social cards (the image Worker's `og` and `og-site`): 1200x630 JPEG,
 * the photo cropped to cover it with the site badge on top, and for `og`
 * the photo's caption (workers/image/src/caption.ts) over a shade. Made by
 * the admin's browser like the copies (admin/src/lib/og-card.ts).
 */
export const CARD_PRESETS = ["og", "og-site"] as const;
export type CardPreset = (typeof CARD_PRESETS)[number];
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export const isCardPresetName = (s: unknown): s is CardPreset =>
  (CARD_PRESETS as readonly unknown[]).includes(s);

/** An `og` card's caption: two short ASCII lines, either may be absent. */
export type CardCaption = { primary?: string; secondary?: string };

/**
 * R2 custom metadata of an `og` card: the caption drawn on it
 * (cardCaptionValue). The image Worker serves the card only while it is
 * the caption it would draw now: public metadata that changed (or was
 * hidden) never shows on a stored card.
 */
export const RESIZED_CAPTION = "caption";

/** The caption as stored with an `og` card and compared by the Worker. */
export const cardCaptionValue = (caption: CardCaption): string =>
  JSON.stringify([caption.primary ?? "", caption.secondary ?? ""]);

/**
 * R2 key under which the image Worker asks for a photo's `og` card to be
 * made again (its caption changed, or it was never made): an empty object
 * per public id, which the admin's maker lists, remakes and deletes.
 */
export const CARD_WANTED_PREFIX = "og-wanted/";

/**
 * Custom metadata of a request Image Transformations would not draw (its
 * caption refused): the image Worker passes it over, the admin's browser
 * makes it, whatever the site's maker.
 */
export const CARD_FOR_BROWSER = "for-browser";
export const cardWantedKey = (publicId: string): string =>
  `${CARD_WANTED_PREFIX}${publicId}`;

/** The part of an R2 binding the copies are listed and removed through. */
export type CopiesBucket = {
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<
    { objects: { key: string }[] } & (
      { truncated: true; cursor: string } | { truncated: false }
    )
  >;
  delete(keys: string[]): Promise<void>;
};

/**
 * Remove the photo `publicId`'s copies and cards, all of them or, with
 * `keepSource`, those made from another file (the photo shows another
 * file now). Returns how many objects went.
 */
export const removeCopies = async (
  bucket: CopiesBucket,
  publicId: string,
  keepSource: string | null = null,
): Promise<number> => {
  const prefix = `img/${publicId}/`;
  const keep =
    keepSource === null
      ? null
      : resizedKey(publicId, keepSource, "h240").replace(/h240$/, "");
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    const gone = page.objects
      .map((o) => o.key)
      .filter((k) => keep === null || !k.startsWith(keep));
    if (gone.length > 0) await bucket.delete(gone);
    removed += gone.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
};

/**
 * The R2 key of a photo's copy (or card) at `preset`: under its public id
 * and the key of the file it was made from (the file the photo shows, or
 * its display copy), so a photo that shows another file gets new copies
 * and never the old ones. The image Worker builds it from what the API
 * gives it after checking the photo may be shown; nothing else serves the
 * bucket.
 */
export const resizedKey = (
  publicId: string,
  sourceKey: string,
  preset: ResizedPreset | CardPreset,
): string =>
  `img/${publicId}${sourceKey.startsWith("/") ? "" : "/"}${sourceKey}/${preset}`;
