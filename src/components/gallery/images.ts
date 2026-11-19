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

/**
 * What to show: a photo (the Worker serves it by public id, so it can tell
 * whether the photo may be shown) or a bucket path (camera pictures). A
 * photo's `file` is null when its file name is not public.
 */
export type ImageSource =
  | {
      id: string;
      file: string | null;
      /** The pixel size as displayed, when known (photoSize). */
      width?: number | null;
      height?: number | null;
    }
  | string;

const fileOf = (src: ImageSource): string | null =>
  typeof src === "string" ? src : src.file;

export const originalUrl = (s3Base: string, file: string): string =>
  s3Base + file;

/**
 * Stand-in without the image Worker (dev, tests) for a photo whose file
 * name is not public: there is no original URL to use. A grey square.
 */
export const HIDDEN_ORIGINAL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23d4d4d8'/%3E%3C/svg%3E";

export const imageUrl = (
  s3Base: string,
  src: ImageSource,
  imageBase: string | undefined,
  preset: PresetName,
): string => {
  if (!imageBase) {
    const file = fileOf(src);
    return file === null ? HIDDEN_ORIGINAL : originalUrl(s3Base, file);
  }
  const base = imageBase.replace(/\/$/, "");
  return `${typeof src === "string" ? base + src : `${base}/${src.id}`}?size=${preset}`;
};

/**
 * `srcset` from (preset, descriptor) pairs, e.g. [["h240", "1x"]].
 * Undefined when resizing is off: every candidate would be the same original.
 */
export const srcSet = (
  s3Base: string,
  src: ImageSource,
  imageBase: string | undefined,
  candidates: [PresetName, string][],
): string | undefined => {
  if (!imageBase) return undefined;
  return candidates
    .map(([preset, d]) => `${imageUrl(s3Base, src, imageBase, preset)} ${d}`)
    .join(", ");
};

/**
 * Pixel size encoded in the file name, as VRChat names its screenshots
 * (`VRChat_2023-12-11_01-21-32.519_7680x4320.png`). Passed to <img> as
 * width/height so the browser reserves the tile's aspect ratio before the
 * image loads. Empty when the name carries no size, or is not public.
 */
export const dimensionsFromFile = (
  file: string | null,
): { width: number; height: number } | Record<string, never> => {
  if (file === null) return {};
  const match = /_(\d+)x(\d+)\.[A-Za-z]+$/.exec(file);
  if (!match) return {};
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : {};
};

/**
 * A photo's pixel size as displayed: the API's `width` / `height` (after
 * the EXIF orientation), else empty. Not the file name's: the API leaves
 * the size out while an edit is shown (it may be cropped), and the name
 * is the original's.
 */
export const photoSize = (photo: {
  width?: number | null;
  height?: number | null;
}): { width: number; height: number } | Record<string, never> =>
  photo.width != null &&
  photo.height != null &&
  photo.width > 0 &&
  photo.height > 0
    ? { width: photo.width, height: photo.height }
    : {};

/** Grid rows are at most 240 CSS px tall; 2x for high-density screens. */
export const GRID_CANDIDATES: [PresetName, string][] = [
  ["h240", "1x"],
  ["h480", "2x"],
];
