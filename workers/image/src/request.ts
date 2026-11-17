/**
 * Pure request parsing for the image Worker (tested with Vitest).
 *
 * URL shape: /img/<preset>/<file>, e.g. /img/h240/VRChat/2023-12/a.png.
 * Only the presets below can be requested, so the number of distinct
 * transformations (the unit Cloudflare's free tier counts) stays bounded.
 */

export const PRESETS = {
  // Grid rows (CSS height 240px) at 1x and 2x.
  h240: { height: 240 },
  h480: { height: 480 },
  // og:image.
  w1200: { width: 1200 },
  // Full-screen overlay candidates.
  w1920: { width: 1920 },
  w2560: { width: 2560 },
  w3840: { width: 3840 },
} as const;

export type PresetName = keyof typeof PRESETS;

export type ImageRequest = {
  preset: PresetName;
  /** Path of the original under the bucket, starting with "/". */
  file: string;
};

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const IMAGE_EXTENSION = /\.(png|jpe?g)$/i;

const isPreset = (name: string): name is PresetName =>
  Object.prototype.hasOwnProperty.call(PRESETS, name);

/** Parse `/img/<preset>/<file>`; null for anything else. */
export const parseImagePath = (pathname: string): ImageRequest | null => {
  const match = /^\/img\/([^/]+)(\/.+)$/.exec(pathname);
  if (!match) return null;
  const [, preset, file] = match;
  if (!isPreset(preset)) return null;
  const segments = file.slice(1).split("/");
  if (
    segments.some((s) => s === "." || s === ".." || !SEGMENT.test(s)) ||
    !IMAGE_EXTENSION.test(file)
  ) {
    return null;
  }
  return { preset, file };
};

export type OutputFormat = "avif" | "webp" | "jpeg";

/**
 * Best output format the browser accepts. AVIF output is capped at 1200px by
 * Cloudflare; above that it falls back to WebP/JPEG on its own.
 */
export const pickFormat = (accept: string | null): OutputFormat => {
  if (accept?.includes("image/avif")) return "avif";
  if (accept?.includes("image/webp")) return "webp";
  return "jpeg";
};
