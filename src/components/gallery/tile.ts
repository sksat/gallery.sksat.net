// The grid's justified layout (gallery.tsx), as plain functions.
//
// Rows wrap like text. Each tile starts at the row height times its
// photo's aspect ratio (flex-basis) and keeps that ratio (aspect-ratio);
// the space left at the end of a row is shared out in proportion to the
// ratios (flex-grow), so every tile of a row widens by the same factor and,
// keeping its ratio, grows equally tall: the row stays straight and no
// photo is cropped (only by the rounding to whole pixels). A filler after
// the last tile takes the last row's space, so that row stays at the row
// height instead of stretching a few photos across the screen.

import { photoSize } from "./images";

/** Until a photo of unknown size loads: the most common camera shape. */
export const FALLBACK_ASPECT = 3 / 2;

/**
 * The filler's flex-grow: so much more than any row of tiles (whose
 * grows are their aspect ratios) that it takes nearly all the last row's
 * space.
 */
export const FILLER_GROW = 1e6;

/** A usable aspect ratio (width / height), or null. */
export const aspectOf = (width: number, height: number): number | null =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : null;

/**
 * A photo's tile aspect ratio: its size from the API, else `natural` (the
 * image's own size once loaded), else FALLBACK_ASPECT.
 */
export const tileAspect = (
  photo: { width?: number | null; height?: number | null },
  natural?: number | null,
): number => {
  const size = photoSize(photo);
  return (
    ("width" in size ? aspectOf(size.width, size.height) : null) ??
    natural ??
    FALLBACK_ASPECT
  );
};

/** Whether a tile already has its photo's size (no need to wait for it). */
export const hasKnownSize = (photo: {
  width?: number | null;
  height?: number | null;
}): boolean => "width" in photoSize(photo);

/**
 * The tile's inline style: its ratio for the classes' basis and
 * aspect-ratio (`--ar`), and its share of a row's spare width.
 */
export const tileStyle = (aspect: number): Record<string, string> => {
  const ar = String(Math.round(aspect * 1e4) / 1e4);
  return { "--ar": ar, "flex-grow": ar };
};
