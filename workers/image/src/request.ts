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
  // Full-screen overlay candidates (w1200 for phones).
  w1200: { width: 1200 },
  w1920: { width: 1920 },
  w2560: { width: 2560 },
  w3840: { width: 3840 },
  // og:image social card: a 1200x630 crop with the site badge drawn on top.
  og: { width: 1200, height: 630 },
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

/**
 * Overlay for the `og` preset, served by Cloudflare Pages from public/ on the
 * same host as the Worker. Regenerate it with workers/image/og-badge.sh.
 */
export const OG_BADGE_PATH = "/og-badge.png";

/** The subset of `cf.image` options the Worker uses. */
export type TransformOptions = {
  width?: number;
  height?: number;
  fit: "scale-down" | "cover";
  gravity?: "auto";
  format: OutputFormat;
  quality?: number;
  draw?: { url: string; left: number; bottom: number }[];
};

/**
 * `cf.image` options for a preset.
 *
 * `origin` is the Worker's own origin (e.g. "https://gallery.sksat.net"),
 * where the badge for social cards is served.
 */
export const transformOptions = (
  preset: PresetName,
  accept: string | null,
  origin: string,
): TransformOptions => {
  if (preset === "og") {
    return {
      ...PRESETS.og,
      fit: "cover",
      gravity: "auto",
      // Social crawlers (X in particular) do not reliably accept AVIF/WebP,
      // so cards are always JPEG whatever the Accept header says.
      format: "jpeg",
      quality: 85,
      draw: [{ url: origin + OG_BADGE_PATH, left: 32, bottom: 32 }],
    };
  }
  return { ...PRESETS[preset], fit: "scale-down", format: pickFormat(accept) };
};

/** Whether the response for a preset depends on the Accept header. */
export const variesByAccept = (preset: PresetName): boolean => preset !== "og";
