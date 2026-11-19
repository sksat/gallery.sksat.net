// An image's width and height from its header bytes, without decoding it:
// a PNG's IHDR chunk or a JPEG's SOF segment. The uploader uses it to
// refuse photos the image Worker could not resize (upload.ts). Covered by
// image-size.spec.ts.

import { isJpeg, isPng } from "./photo-meta";

export type ImageSize = { width: number; height: number };

/** PNG: the first chunk must be IHDR (13 bytes: width, height, ...). */
const pngSize = (b: Uint8Array): ImageSize | null => {
  if (b.length < 24) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (type !== "IHDR" || view.getUint32(8, false) !== 13) return null;
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
};

/**
 * Start-of-frame markers (baseline, progressive, lossless, arithmetic…):
 * C0–CF except C4 (DHT), C8 (reserved) and CC (DAC).
 */
const isSof = (m: number) =>
  m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** JPEG: walk the segments up to the first SOF (or the start of scan). */
const jpegSize = (b: Uint8Array): ImageSize | null => {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      p++;
      continue;
    }
    // Markers without a length (TEM, RSTn).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    const len = view.getUint16(p + 2, false);
    if (len < 2) return null;
    if (isSof(marker)) {
      // Length, precision (1), height (2), width (2).
      if (p + 9 > b.length) return null;
      return {
        height: view.getUint16(p + 5, false),
        width: view.getUint16(p + 7, false),
      };
    }
    p += 2 + len;
  }
  return null;
};

/**
 * Width and height of a PNG or JPEG from its first bytes, or null when the
 * bytes are not one, are cut off before the size, or give a zero size
 * (a JPEG whose height comes later in a DNL segment).
 */
export const imageSize = (b: Uint8Array): ImageSize | null => {
  let size: ImageSize | null = null;
  try {
    if (isPng(b)) size = pngSize(b);
    else if (isJpeg(b)) size = jpegSize(b);
  } catch {
    return null;
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
};
