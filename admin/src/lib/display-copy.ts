// The display copy of an original that Cloudflare Image Transformations
// cannot resize (over 100 MB, 12,000 px a side or 100 MP; upload.ts
// needsDisplayCopy). Rare: only such originals get one. The browser
// decodes the original and draws it scaled down onto a canvas (long side
// DISPLAY_MAX_SIDE, or DISPLAY_SMALL_SIDE where a canvas that large cannot
// be made, e.g. iOS Safari), orientation applied, on white, and encodes it
// as a JPEG without EXIF (a comment names the original's hash, so the copy
// has bytes of its own). It goes up beside the original as its media_file
// row with role display (migration 0013), and every resize uses it; the
// original keeps its hash and metadata.
//
// makeDisplayCopyWith is the plain part (Vitest, display-copy.spec.ts);
// renderCopy is the browser's.

import {
  DISPLAY_CONTENT_TYPE,
  DISPLAY_MAX_SIDE,
  DISPLAY_QUALITY,
  DISPLAY_SMALL_SIDE,
  displaySize,
  resizeLimitsProblem,
} from "./upload";
import { UploadError, type DisplayCopy } from "./upload-queue";

// What the panel says when no copy could be made, by what went wrong (the
// copy itself is the uploader's business, not the user's): the image did
// not decode (a cause this code cannot tell: memory, a broken file, a
// format the browser lacks), the browser cannot make even a 4,096 px
// canvas (known: its size limit), or something else. Each ends with what
// always works: an image within the resize limits needs no copy.

const SMALLER =
  "100 MB、1 辺 12,000 px、1 億画素までに縮小した画像なら追加できます。";

/** The image did not decode in this browser. */
export const COPY_READ_FAILED = `この画像をこのブラウザでは読み込めませんでした。${SMALLER}`;

/** No canvas this browser can make holds even the smaller copy. */
export const COPY_TOO_LARGE = `この画像はこのブラウザで縮小できる大きさを超えています。${SMALLER}`;

/** Anything else (the encode failed, the copy came out too large). */
export const COPY_FAILED = `この画像をこのブラウザでは縮小できませんでした。${SMALLER}`;

/** Thrown when the image cannot be decoded at all. */
export class ImageDecodeError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ImageDecodeError";
  }
}

/** A rendered copy: a JPEG and its size in pixels. */
export type Rendered = { blob: Blob; width: number; height: number };

/**
 * A display copy from `render`, trying DISPLAY_MAX_SIDE first and then
 * DISPLAY_SMALL_SIDE: a size whose canvas cannot be made (null), that
 * fails (a throw; ImageDecodeError when the image did not decode), or
 * whose copy is still over the resize limits moves on to the next. When
 * none worked, throws a non-retryable UploadError whose message follows
 * the last failure (the smaller size says the most).
 */
export const makeDisplayCopyWith = async (
  render: (maxSide: number) => Promise<Rendered | null>,
  hash: (blob: Blob) => Promise<string>,
): Promise<DisplayCopy> => {
  let message = COPY_FAILED;
  for (const side of [DISPLAY_MAX_SIDE, DISPLAY_SMALL_SIDE]) {
    let out: Rendered | null;
    try {
      out = await render(side);
    } catch (err) {
      console.warn(`display copy at ${side} px failed:`, err);
      message =
        err instanceof ImageDecodeError ? COPY_READ_FAILED : COPY_FAILED;
      continue;
    }
    if (!out) {
      message = COPY_TOO_LARGE;
      continue;
    }
    const facts = { size: out.blob.size, width: out.width, height: out.height };
    if (facts.size <= 0 || resizeLimitsProblem(facts)) {
      message = COPY_FAILED;
      continue;
    }
    return { blob: out.blob, ...facts, sha256: await hash(out.blob) };
  }
  throw new UploadError(message, false);
};

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
};

/**
 * The image decoded with its orientation applied: scaled down while
 * decoding where the browser can (createImageBitmap's resizeWidth, so the
 * full-size bitmap need not be held; `shown` is the size it is shown at,
 * orientedSize), else at full size, through an <img>.
 */
const decode = async (
  blob: Blob,
  shown: { width: number; height: number } | null,
  maxSide: number,
): Promise<Decoded> => {
  if (typeof createImageBitmap === "function") {
    try {
      // Only the width (in the oriented image, which is what the browser
      // resizes): the aspect is kept, and the canvas fits it after anyway.
      const resizeWidth = shown
        ? displaySize(shown.width, shown.height, maxSide).width
        : null;
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
        ...(shown && resizeWidth !== null && resizeWidth < shown.width
          ? { resizeWidth, resizeQuality: "high" as const }
          : {}),
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall back to an <img> below.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError(err);
  }
};

/**
 * Draw the original onto a canvas at most `maxSide` on its long side and
 * encode it. Null when this browser cannot make a canvas that large: it
 * then gives no context, or one that silently draws nothing (iOS Safari
 * past its canvas area), which the white fill read back shows.
 */
export const renderCopy = async (
  blob: Blob,
  shown: { width: number; height: number } | null,
  maxSide: number,
): Promise<Rendered | null> => {
  const image = await decode(blob, shown, maxSide);
  const canvas = document.createElement("canvas");
  try {
    const { width, height } = displaySize(image.width, image.height, maxSide);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White under transparent PNGs (JPEG has no alpha), and the probe.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    if (ctx.getImageData(width - 1, height - 1, 1, 1).data[3] !== 255) {
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.source, 0, 0, width, height);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, DISPLAY_CONTENT_TYPE, DISPLAY_QUALITY),
    );
    // (Not null: that means the canvas could not be made.)
    if (!jpeg || jpeg.type !== DISPLAY_CONTENT_TYPE) {
      throw new Error("the canvas did not encode a JPEG");
    }
    return { blob: jpeg, width, height };
  } finally {
    image.close();
    // Let the browser drop the canvas's memory now, not at GC.
    canvas.width = 0;
    canvas.height = 0;
  }
};

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

/** The display copy of `blob` in this browser (see makeDisplayCopyWith). */
export const makeDisplayCopy = async (
  blob: Blob,
  original: {
    /** The header's size (image-size.ts), before the EXIF orientation. */
    stored: { width: number; height: number } | null;
    /** EXIF Orientation (1–8), if any. */
    orientation?: number;
    /** The original's SHA-256, written into the copy (withComment). */
    sha256: string;
  },
): Promise<DisplayCopy> => {
  const shown =
    original.stored && orientedSize(original.stored, original.orientation);
  return makeDisplayCopyWith(
    async (side) => {
      const out = await renderCopy(blob, shown, side);
      if (!out) return null;
      // Bytes of its own even when two originals differ only in metadata
      // (every file's hash is unique, media_file 0013).
      const bytes = withComment(
        new Uint8Array(await out.blob.arrayBuffer()),
        `original sha256 ${original.sha256}`,
      );
      return {
        ...out,
        blob: new Blob([bytes], { type: DISPLAY_CONTENT_TYPE }),
      };
    },
    async (b) =>
      hex(await crypto.subtle.digest("SHA-256", await b.arrayBuffer())),
  );
};

/**
 * The size an image is shown at: its header's, turned for EXIF
 * orientations 5–8 (a quarter turn), which createImageBitmap applies
 * before it resizes.
 */
export const orientedSize = (
  stored: { width: number; height: number },
  orientation?: number,
): { width: number; height: number } =>
  orientation !== undefined && orientation >= 5 && orientation <= 8
    ? { width: stored.height, height: stored.width }
    : stored;

/**
 * `jpeg` with a COM segment holding `text` right after its SOI (ASCII,
 * at most 65,533 bytes), or `jpeg` unchanged when it does not start with
 * an SOI. A comment, not EXIF: nothing reads it, and resizing drops it.
 */
export const withComment = (
  jpeg: Uint8Array<ArrayBuffer>,
  text: string,
): Uint8Array<ArrayBuffer> => {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const body = new TextEncoder().encode(text).subarray(0, 65_533);
  const out = new Uint8Array(jpeg.length + 4 + body.length);
  out.set([
    0xff,
    0xd8,
    0xff,
    0xfe,
    (body.length + 2) >> 8,
    (body.length + 2) & 0xff,
  ]);
  out.set(body, 6);
  out.set(jpeg.subarray(2), 6 + body.length);
  return out;
};
