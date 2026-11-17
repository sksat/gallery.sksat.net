// Resized image URLs from the image Worker (../../../workers/image in the
// root project), mirrored from the public gallery's helper
// (../../../src/components/gallery/images.ts). Kept duplicated so admin
// remains independently buildable, like types.ts; review both when changing.
//
// Unlike the public gallery there is deliberately no fallback to the
// originals (up to ~37MB PNGs in B2): without an image base URL the UI shows
// a placeholder tile instead.

/**
 * Must match `PRESETS` in workers/image/src/request.ts exactly. The Worker
 * 404s anything else, and every distinct file+preset counts toward the
 * monthly transformation quota, so never add one here on its own.
 */
export const PRESETS = [
  "h240",
  "h480",
  "w1200",
  "w1920",
  "w2560",
  "w3840",
] as const;

export type PresetName = (typeof PRESETS)[number];

/**
 * Normalise the IMAGE_BASE_URL var: trimmed, no trailing slash, http(s)
 * only. Null (thumbnails off) when unset, empty or malformed.
 */
export const normalizeImageBase = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/]/.test(s) ? s : null;
};

/** `<base>/<preset><file>`; `file` starts with "/" like media rows do. */
export const imageUrl = (
  imageBase: string,
  file: string,
  preset: PresetName,
): string => `${imageBase}/${preset}${file.startsWith("/") ? "" : "/"}${file}`;

/** `srcset` from (preset, descriptor) pairs, e.g. [["h240", "1x"]]. */
export const srcSet = (
  imageBase: string,
  file: string,
  candidates: readonly (readonly [PresetName, string])[],
): string =>
  candidates
    .map(([preset, d]) => `${imageUrl(imageBase, file, preset)} ${d}`)
    .join(", ");

/**
 * Pixel size encoded in the file name, as VRChat names its screenshots
 * (`VRChat_2023-12-11_01-21-32.519_7680x4320.png`). Empty when absent.
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

/** Upper-case extension for the placeholder tile ("PNG"); "" if none. */
export const fileExtension = (file: string): string => {
  const m = /\.([A-Za-z0-9]+)$/.exec(file);
  return m ? m[1].toUpperCase() : "";
};

/** List thumbnails are under 240 CSS px tall; 2x for high-density screens. */
export const LIST_CANDIDATES = [
  ["h240", "1x"],
  ["h480", "2x"],
] as const satisfies readonly (readonly [PresetName, string])[];

/** Edit page preview (at most ~768 CSS px wide), chosen by width. */
export const PREVIEW_CANDIDATES = [
  ["w1200", "1200w"],
  ["w1920", "1920w"],
] as const satisfies readonly (readonly [PresetName, string])[];
