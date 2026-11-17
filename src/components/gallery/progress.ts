/**
 * Download helpers for the photo overlay's progress bar.
 *
 * An <img> does not report download progress, so the overlay fetches the
 * full-size image itself, reports bytes received against Content-Length,
 * and hands the result to the <img> as a blob: URL.
 */
import type { PresetName } from "./images";

/**
 * Overlay presets by pixel width, smallest first. w1200 is the og:image
 * preset, reused so phones don't fetch 1920px.
 */
const OVERLAY_WIDTHS: [PresetName, number][] = [
  ["w1200", 1200],
  ["w1920", 1920],
  ["w2560", 2560],
  ["w3840", 3840],
];

/**
 * Smallest overlay preset at least as wide as the image will be drawn
 * (CSS width × devicePixelRatio), or the largest one if none is.
 */
export const pickOverlayPreset = (
  cssWidth: number,
  devicePixelRatio: number,
): PresetName => {
  const needed = cssWidth * devicePixelRatio;
  const fit = OVERLAY_WIDTHS.find(([, w]) => w >= needed);
  return (fit ?? OVERLAY_WIDTHS[OVERLAY_WIDTHS.length - 1])[0];
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
