// A photo's social cards (`og`, `og-site`) drawn in the browser, as the
// image Worker's Image Transformations draw them (workers/image/src/
// request.ts cardDraw): 1200x630, the photo scaled to cover it and cropped
// around its centre (Cloudflare's gravity "auto" may pick another crop),
// the site badge at the bottom left and, on `og`, the caption right-aligned
// beside it over a dark shade, in the same font subset. The assets are
// copies of the public site's (public/og-*.png, public/fonts/; og-card.
// spec.ts checks they are the same bytes). Encoded as JPEG at 0.85, like
// the Worker's cards (quality 85). Browser only.

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  type CardCaption,
} from "@shared/resized/resized";

export const OG_ASSET_URLS = {
  badge: "/og/og-badge.png",
  shade: "/og/og-shade.png",
  font: "/og/Roboto-Bold-subset.ttf",
} as const;

/** The font family name the caption is drawn with (loaded once). */
const FAMILY = "OgCaption";

/** JPEG quality of a card, as the Worker's (85). */
export const CARD_QUALITY = 0.85;

type Assets = { badge: ImageBitmap; shade: ImageBitmap };
let assets: Promise<Assets> | null = null;

const bitmapOf = async (url: string): Promise<ImageBitmap> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
};

/** The badge, the shade and the font, fetched once per tab. */
const loadAssets = (): Promise<Assets> => {
  assets ??= (async () => {
    const font = new FontFace(FAMILY, `url(${OG_ASSET_URLS.font})`);
    await font.load();
    document.fonts.add(font);
    const [badge, shade] = await Promise.all([
      bitmapOf(OG_ASSET_URLS.badge),
      bitmapOf(OG_ASSET_URLS.shade),
    ]);
    return { badge, shade };
  })().catch((err: unknown) => {
    assets = null;
    throw err;
  });
  return assets;
};

/**
 * Where the photo goes: scaled to cover the card, centred (the part
 * outside it is cropped).
 */
export const coverRect = (
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } => {
  const scale = Math.max(CARD_WIDTH / width, CARD_HEIGHT / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return {
    x: Math.round((CARD_WIDTH - w) / 2),
    y: Math.round((CARD_HEIGHT - h) / 2),
    width: w,
    height: h,
  };
};

/**
 * The caption's lines as the Worker draws them: `bottom` is from the
 * card's bottom edge to the text's, so the block is centred on the badge.
 */
export const captionLines = (
  caption: CardCaption,
): { text: string; size: number; bottom: number }[] => {
  const { primary, secondary } = caption;
  const lines: { text: string; size: number; bottom: number }[] = [];
  if (primary) {
    lines.push({ text: primary, size: 40, bottom: secondary ? 76 : 56 });
  }
  if (secondary) {
    lines.push({ text: secondary, size: 28, bottom: primary ? 38 : 63 });
  }
  return lines;
};

const encode = async (canvas: OffscreenCanvas | HTMLCanvasElement) => {
  const blob =
    "convertToBlob" in canvas
      ? await canvas.convertToBlob({
          type: "image/jpeg",
          quality: CARD_QUALITY,
        })
      : await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", CARD_QUALITY),
        );
  if (blob?.type !== "image/jpeg") throw new Error("cannot encode JPEG");
  return blob;
};

/**
 * A card of `image` (decoded, as displayed), with `caption` (`og`) or
 * without (`og-site`, or an `og` with nothing to say).
 */
export const drawCard = async (
  image: ImageBitmap,
  caption: CardCaption | null,
): Promise<Blob> => {
  const { badge, shade } = await loadAssets();
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(CARD_WIDTH, CARD_HEIGHT)
      : Object.assign(document.createElement("canvas"), {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
        });
  const ctx = canvas.getContext("2d") as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("no 2D canvas");
  const r = coverRect(image.width, image.height);
  let scaled: ImageBitmap | null = null;
  try {
    scaled = await createImageBitmap(image, {
      resizeWidth: r.width,
      resizeHeight: r.height,
      resizeQuality: "high",
    });
  } catch {
    scaled = null;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scaled ?? image, r.x, r.y, r.width, r.height);
  scaled?.close();
  const lines = caption ? captionLines(caption) : [];
  if (lines.length > 0) {
    ctx.drawImage(shade, 0, CARD_HEIGHT - shade.height);
  }
  ctx.drawImage(badge, 32, CARD_HEIGHT - 32 - badge.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  for (const line of lines) {
    ctx.font = `${line.size}px ${FAMILY}`;
    // The Worker's `bottom` is to the bottom of the drawn glyphs (checked
    // against a card Cloudflare drew): the baseline sits that much higher.
    const descent = ctx.measureText(line.text).actualBoundingBoxDescent;
    ctx.fillText(
      line.text,
      CARD_WIDTH - 40,
      CARD_HEIGHT - line.bottom - descent,
    );
  }
  return encode(canvas);
};
