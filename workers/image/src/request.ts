/**
 * Pure request parsing for the image Worker (tested with Vitest).
 *
 * URL shape: /img/<preset>/<file>, e.g. /img/h240/VRChat/2023-12/a.png.
 * Only the presets below can be requested, so the number of distinct
 * transformations (the unit Cloudflare's free tier counts) stays bounded.
 */
import type { Caption } from "./caption";

export const PRESETS = {
  // Grid rows (CSS height 240px) at 1x and 2x.
  h240: { height: 240 },
  h480: { height: 480 },
  // Full-screen overlay candidates (w1200 for phones).
  w1200: { width: 1200 },
  w1920: { width: 1920 },
  w2560: { width: 2560 },
  w3840: { width: 3840 },
  // og:image social cards: a 1200x630 crop with the site badge drawn on top.
  // `og` (photo pages) adds the photo's date, camera and tags.
  og: { width: 1200, height: 630 },
  "og-site": { width: 1200, height: 630 },
} as const;

export type PresetName = keyof typeof PRESETS;

export type ImageRequest =
  | {
      preset: PresetName;
      /** A photo by its public id; the API resolves it to a file. */
      id: string;
    }
  | {
      preset: PresetName;
      /** Path of the original under the bucket, starting with "/". */
      file: string;
    };

/** A photo's public id (workers/api/src/route.ts, admin migration 0003). */
export const PUBLIC_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const IMAGE_EXTENSION = /\.(png|jpe?g)$/i;

const isPreset = (name: string): name is PresetName =>
  Object.prototype.hasOwnProperty.call(PRESETS, name);

/**
 * Parse `/img/<preset>/<public_id>` (gallery photos: the API checks the
 * photo may be shown) or `/img/<preset>/<file>` (a bucket path: the admin's
 * thumbnails, camera pictures, and URLs from before public ids); null for
 * anything else. A file path always has an image extension, so the two
 * never overlap.
 */
export const parseImagePath = (pathname: string): ImageRequest | null => {
  const match = /^\/img\/([^/]+)(\/.+)$/.exec(pathname);
  if (!match) return null;
  const [, preset, file] = match;
  if (!isPreset(preset)) return null;
  if (PUBLIC_ID_RE.test(file.slice(1))) return { preset, id: file.slice(1) };
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
 * Card assets, served by Cloudflare Pages from public/ on the same host as
 * the Worker. Regenerate them with workers/image/og-assets.sh.
 */
export const OG_ASSETS = {
  /** Avatar + "sksat gallery" pill, 96px tall. */
  badge: "/og-badge.png",
  /** 1200x240 transparent-to-dark gradient behind the caption. */
  shade: "/og-shade.png",
  /** Roboto Bold subset to printable ASCII, "·" and "…". */
  font: "/fonts/Roboto-Bold-subset.ttf",
} as const;

export type DrawImage = {
  url: string;
  left?: number;
  right?: number;
  bottom?: number;
};

export type DrawText = {
  text: string;
  font: { url: string };
  color: string;
  size: number;
  right: number;
  bottom: number;
};

/** The subset of `cf.image` options the Worker uses. */
export type TransformOptions = {
  width?: number;
  height?: number;
  fit: "scale-down" | "cover";
  gravity?: "auto";
  format: OutputFormat;
  quality?: number;
  draw?: (DrawImage | DrawText)[];
};

/** Presets that render a social card (always JPEG, 1200x630). */
export const isCardPreset = (preset: PresetName): boolean =>
  preset === "og" || preset === "og-site";

/**
 * Arguments of the AdminImage entrypoint: a bucket path (any photo or
 * camera picture, private included) and a resize preset. Validated with the
 * same rules as public bucket paths; cards are public-only. Null otherwise.
 */
export const parseAdminImage = (
  preset: unknown,
  file: unknown,
): { preset: PresetName; file: string } | null => {
  if (typeof preset !== "string" || typeof file !== "string") return null;
  if (preset.includes("/") || !file.startsWith("/")) return null;
  const parsed = parseImagePath(`/img/${preset}${file}`);
  if (!parsed || !("file" in parsed) || isCardPreset(parsed.preset)) {
    return null;
  }
  return parsed;
};

/**
 * Overlays for a card: the badge bottom-left and, if given, the caption
 * right-aligned beside it over a dark gradient.
 */
const cardDraw = (
  origin: string,
  caption: Caption,
): (DrawImage | DrawText)[] => {
  const text = (s: string, size: number, bottom: number): DrawText => ({
    text: s,
    font: { url: origin + OG_ASSETS.font },
    color: "#ffffff",
    size,
    right: 40,
    bottom,
  });
  // Offsets keep the text block vertically centred on the badge (32..128).
  const { primary, secondary } = caption;
  const lines: DrawText[] = [];
  if (secondary) lines.push(text(secondary, 28, primary ? 38 : 63));
  if (primary) lines.push(text(primary, 40, secondary ? 76 : 56));
  return [
    ...(lines.length > 0
      ? [{ url: origin + OG_ASSETS.shade, left: 0, bottom: 0 }]
      : []),
    { url: origin + OG_ASSETS.badge, left: 32, bottom: 32 },
    ...lines,
  ];
};

/**
 * `cf.image` options for a preset.
 *
 * `origin` is the Worker's own origin (e.g. "https://gallery.sksat.net"),
 * where the card assets are served. `caption` is drawn on `og` cards only
 * (`og-site`, the top page's card, has just the badge).
 */
export const transformOptions = (
  preset: PresetName,
  accept: string | null,
  origin: string,
  caption: Caption = {},
): TransformOptions => {
  if (isCardPreset(preset)) {
    return {
      ...PRESETS[preset],
      fit: "cover",
      gravity: "auto",
      // Social crawlers (X in particular) do not reliably accept AVIF/WebP,
      // so cards are always JPEG whatever the Accept header says.
      format: "jpeg",
      quality: 85,
      draw: cardDraw(origin, preset === "og" ? caption : {}),
    };
  }
  return { ...PRESETS[preset], fit: "scale-down", format: pickFormat(accept) };
};

/** Whether the response for a preset depends on the Accept header. */
export const variesByAccept = (preset: PresetName): boolean =>
  !isCardPreset(preset);

/**
 * Whether Image Transformations failed. Some failures still answer 2xx with
 * the untransformed original and report the error in `Cf-Resized: err=...`.
 */
export const transformFailed = (
  status: number,
  cfResized: string | null,
): boolean => status < 200 || status >= 300 || /\berr=/.test(cfResized ?? "");
