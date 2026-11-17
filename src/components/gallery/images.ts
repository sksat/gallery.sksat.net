/**
 * Image URLs, optionally served resized by the image Worker (workers/image).
 *
 * The originals in B2 are up to 7680x4320 PNGs (~37MB each), far too large
 * for the grid. When `imageBase` (VITE_IMAGE_BASE_URL, e.g.
 * "https://gallery.sksat.net/img") is set, URLs point at the Worker, which
 * returns the photo resized to one of a fixed set of presets in AVIF/WebP.
 * When it is empty (dev, tests), the originals are used as-is.
 */
import type { PresetName } from "../../../workers/image/src/request";

export type { PresetName };

export const originalUrl = (s3Base: string, file: string): string =>
  s3Base + file;

export const imageUrl = (
  s3Base: string,
  file: string,
  imageBase: string | undefined,
  preset: PresetName,
): string =>
  imageBase
    ? `${imageBase.replace(/\/$/, "")}/${preset}${file}`
    : originalUrl(s3Base, file);

/**
 * `srcset` from (preset, descriptor) pairs, e.g. [["h240", "1x"]].
 * Undefined when resizing is off: every candidate would be the same original.
 */
export const srcSet = (
  s3Base: string,
  file: string,
  imageBase: string | undefined,
  candidates: [PresetName, string][],
): string | undefined => {
  if (!imageBase) return undefined;
  return candidates
    .map(([preset, d]) => `${imageUrl(s3Base, file, imageBase, preset)} ${d}`)
    .join(", ");
};

/**
 * Pixel size encoded in the file name, as VRChat names its screenshots
 * (`VRChat_2023-12-11_01-21-32.519_7680x4320.png`). Passed to <img> as
 * width/height so the browser reserves the tile's aspect ratio before the
 * image loads. Empty when the name carries no size.
 */
export const dimensionsFromFile = (
  file: string,
): { width: number; height: number } | Record<string, never> => {
  const match = /_(\d+)x(\d+)\.[A-Za-z]+$/.exec(file);
  if (!match) return {};
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : {};
};

/** Grid rows are at most 240 CSS px tall; 2x for high-density screens. */
export const GRID_CANDIDATES: [PresetName, string][] = [
  ["h240", "1x"],
  ["h480", "2x"],
];

/** Full-screen overlay, chosen by width with sizes="90vw". */
export const OVERLAY_CANDIDATES: [PresetName, string][] = [
  // w1200 is the og:image preset, reused so phones don't fetch 1920px.
  ["w1200", "1200w"],
  ["w1920", "1920w"],
  ["w2560", "2560w"],
  ["w3840", "3840w"],
];
