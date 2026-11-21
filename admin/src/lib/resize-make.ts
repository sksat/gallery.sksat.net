// Making a photo's resized copies in the browser (src/lib/resized.ts says
// why): the file is decoded once (turned by its EXIF orientation, its
// colours converted to sRGB, as Image Transformations does), then each
// preset of planResized is scaled down from it and encoded as WebP, or
// JPEG where the browser cannot encode WebP (Safari). Browser only;
// checked by the E2E specs (resized.spec.ts), as Node has no decoder.

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  planResized,
  type CardCaption,
  type CardPreset,
  type ResizedPreset,
  type ResizedType,
} from "@shared/resized/resized";
import { drawCard } from "./og-card";

/** Encoder quality, as Image Transformations' default (85). */
export const RESIZED_QUALITY = 0.85;

/** One copy as made (bytes empty for one that is another preset's image). */
export type MadeCopy = {
  preset: ResizedPreset | CardPreset;
  width: number;
  height: number;
  sameAs: ResizedPreset | null;
  type: ResizedType;
  blob: Blob | null;
};

/** The image could not be decoded or encoded here (too large, broken). */
export class ResizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResizeError";
  }
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;

const canvasOf = (width: number, height: number): Canvas => {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
};

const encode = (canvas: Canvas, type: string): Promise<Blob | null> =>
  "convertToBlob" in canvas
    ? canvas.convertToBlob({ type, quality: RESIZED_QUALITY })
    : new Promise((resolve) => canvas.toBlob(resolve, type, RESIZED_QUALITY));

/** Scale `image` to `width` x `height` and encode it. */
const copyOf = async (
  image: ImageBitmap,
  width: number,
  height: number,
): Promise<{ blob: Blob; type: ResizedType }> => {
  // Resized by the browser's high-quality scaler where it can; drawn at
  // the size either way (a browser without the resize options draws the
  // full image scaled).
  let scaled: ImageBitmap | null = null;
  if (width !== image.width || height !== image.height) {
    try {
      scaled = await createImageBitmap(image, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      });
    } catch {
      scaled = null;
    }
  }
  try {
    const canvas = canvasOf(width, height);
    const ctx = canvas.getContext("2d") as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new ResizeError("no 2D canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(scaled ?? image, 0, 0, width, height);
    // A browser that cannot encode WebP gives a PNG instead: use JPEG.
    const webp = await encode(canvas, "image/webp");
    if (webp?.type === "image/webp") return { blob: webp, type: "image/webp" };
    const jpeg = await encode(canvas, "image/jpeg");
    if (jpeg?.type === "image/jpeg") return { blob: jpeg, type: "image/jpeg" };
    throw new ResizeError("cannot encode WebP or JPEG");
  } finally {
    scaled?.close();
  }
};

/**
 * The copies of the image in `blob`, smallest first; `sameAs` ones carry
 * no blob (the preset they name has it). Then its cards (og-card.ts):
 * `og-site`, and `og` with `caption` unless that is null (a photo with no
 * public card, or none known). Throws ResizeError when the browser cannot
 * decode it (e.g. out of memory for a very large PNG): the photo is then
 * left to Image Transformations and tried again later.
 */
export const makeResized = async (
  blob: Blob,
  caption: CardCaption | null = null,
): Promise<MadeCopy[]> => {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      colorSpaceConversion: "default",
    });
  } catch (err) {
    throw new ResizeError(
      `cannot decode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const out: MadeCopy[] = [];
    for (const p of planResized(image.width, image.height)) {
      if (p.sameAs) {
        const target = out.find((c) => c.preset === p.sameAs)!;
        out.push({ ...p, type: target.type, blob: null });
        continue;
      }
      const { blob: made, type } = await copyOf(image, p.width, p.height);
      out.push({ ...p, type, blob: made });
    }
    const card = (preset: CardPreset, blob: Blob): MadeCopy => ({
      preset,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      sameAs: null,
      type: "image/jpeg",
      blob,
    });
    try {
      out.push(card("og-site", await drawCard(image, null)));
      if (caption) out.push(card("og", await drawCard(image, caption)));
    } catch (err) {
      throw new ResizeError(
        `cannot draw the card: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return out;
  } finally {
    image.close();
  }
};
