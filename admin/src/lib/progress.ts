// Download helpers for the edit page's progressive preview, mirrored from
// the public gallery's photo overlay (../../../src/components/gallery/
// progress.ts in the root project). Kept duplicated so admin remains
// independently buildable, like images.ts; review both when changing.
//
// An <img> does not report download progress, so the preview fetches the
// larger image itself, reports bytes received against Content-Length, and
// hands the result to an <img> as a blob: URL.

import { PREVIEW_CANDIDATES, type PresetName } from "./images";

/** Preview presets with their pixel width, smallest first. */
const PREVIEW_WIDTHS: readonly (readonly [PresetName, number])[] =
  PREVIEW_CANDIDATES.map(([preset, w]) => [preset, Number.parseInt(w, 10)]);

/**
 * Smallest preview preset at least as wide as the image will be drawn
 * (CSS width × devicePixelRatio), or the largest one if none is. Only the
 * preview presets (w1200/w1920) are candidates: the box is at most 48rem
 * wide, and every extra file+preset costs a transformation.
 */
export const pickPreviewPreset = (
  cssWidth: number,
  devicePixelRatio: number,
): PresetName => {
  const needed = cssWidth * devicePixelRatio;
  const fit = PREVIEW_WIDTHS.find(([, w]) => w >= needed);
  return (fit ?? PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1])[0];
};

/**
 * Read a response body while reporting progress as a fraction in [0, 1],
 * or null when the total size is unknown (no Content-Length).
 */
export const readWithProgress = async (
  response: Response,
  onProgress: (fraction: number | null) => void,
): Promise<Blob> => {
  const total = Number(response.headers.get("Content-Length")) || 0;
  const type = response.headers.get("Content-Type") ?? "";
  if (!response.body) {
    const blob = await response.blob();
    onProgress(1);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress(total ? 0 : null);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? Math.min(received / total, 1) : null);
  }
  onProgress(1);
  return new Blob(chunks as BlobPart[], { type });
};
