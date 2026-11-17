/**
 * Download helpers for the photo overlay's progress bar, used by the public
 * gallery's overlay and the admin's full-screen preview (plain TS, no
 * framework; each app keeps its own Qwik component).
 *
 * An <img> does not report download progress, so the overlay fetches the
 * full-size image itself, reports bytes received against Content-Length,
 * and hands the result to the <img> as a blob: URL.
 */

/**
 * Smallest preset at least as wide as the image will be drawn (CSS width ×
 * devicePixelRatio) from `widths` (smallest first), or the largest one if
 * none is.
 */
export const pickByWidth = <T extends string>(
  widths: readonly (readonly [T, number])[],
  cssWidth: number,
  devicePixelRatio: number,
): T => {
  const needed = cssWidth * devicePixelRatio;
  const fit = widths.find(([, w]) => w >= needed);
  return (fit ?? widths[widths.length - 1])[0];
};

/**
 * Overlay presets by pixel width, smallest first. w1200 keeps phones from
 * fetching 1920px. These names exist in the image Worker's preset list
 * (and so in both apps' images.ts).
 */
export const OVERLAY_WIDTHS = [
  ["w1200", 1200],
  ["w1920", 1920],
  ["w2560", 2560],
  ["w3840", 3840],
] as const;

export type OverlayPreset = (typeof OVERLAY_WIDTHS)[number][0];

/** The photo box is 90vw wide (see overlayClass.box). */
export const OVERLAY_BOX_WIDTH_RATIO = 0.9;

/** The overlay preset for an image drawn `cssWidth` CSS px wide. */
export const pickOverlayPreset = (
  cssWidth: number,
  devicePixelRatio: number,
): OverlayPreset => pickByWidth(OVERLAY_WIDTHS, cssWidth, devicePixelRatio);

/** A progress value as a whole percentage, or undefined if unknown/done. */
export const progressPercent = (
  progress: number | null | undefined,
): number | undefined =>
  typeof progress === "number" ? Math.round(progress * 100) : undefined;

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
