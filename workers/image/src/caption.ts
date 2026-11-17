/**
 * Caption text for the `og` card (tested with Vitest).
 *
 * The Worker looks the requested file up in media.json and turns its entry
 * into two short lines that Cloudflare draws as text overlays:
 *
 *   2023-12-16 23:12 JST
 *   logilabo VirtualLens2 · #VRChat
 *
 * Only files listed in media.json get a card, and the text comes from
 * media.json alone (never from the URL), so a request cannot put arbitrary
 * text on a gallery.sksat.net image or mint new transformations.
 */

export type Caption = {
  /** Shooting date and time in JST; absent when the photo has none. */
  primary?: string;
  /** Camera and tags. */
  secondary?: string;
};

/** The media.json fields the caption uses. */
export type CaptionSource = {
  world: string;
  timestamp: string | null;
  camera: { make: string; model: string } | null;
  tags: string[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * The entry for `file` in a parsed media.json, or null if it is not listed.
 * Malformed fields are dropped rather than trusted.
 */
export const findCaptionSource = (
  index: unknown,
  file: string,
): CaptionSource | null => {
  if (!Array.isArray(index)) return null;
  const entry: unknown = index.find((e) => isRecord(e) && e.file === file);
  if (!isRecord(entry)) return null;
  const camera = isRecord(entry.camera) ? entry.camera : null;
  const make = str(camera?.make);
  const model = str(camera?.model);
  return {
    world: str(entry.world) ?? "",
    timestamp: str(entry.timestamp),
    camera: make !== null && model !== null ? { make, model } : null,
    tags: Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === "string")
      : [],
  };
};

/** Characters the bundled font subset has (printable ASCII, "·", "…"). */
const clean = (s: string): string =>
  s
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Counted in characters: about 13px each at size 28 for mixed-case text, so
 * 40 keeps a typical line clear of the badge (~760px free to its right).
 */
export const MAX_LINE_LENGTH = 40;

const truncate = (s: string): string =>
  s.length > MAX_LINE_LENGTH ? s.slice(0, MAX_LINE_LENGTH - 1) + "…" : s;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2023-12-16 23:12 JST", or null for a missing or invalid timestamp. */
export const formatJst = (timestamp: string | null): string | null => {
  if (!timestamp) return null;
  const t = new Date(timestamp).getTime();
  if (isNaN(t)) return null;
  const d = new Date(t + 9 * 60 * 60 * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} JST`
  );
};

export const captionFor = (m: CaptionSource): Caption => {
  const camera = m.camera ? clean(`${m.camera.make} ${m.camera.model}`) : "";
  // The world is a tag too (as in the gallery's tag filter), listed first.
  // Spaces inside a tag become "_" so "#night sky" doesn't read as two.
  const tags = [
    ...new Set([m.world, ...m.tags].map((t) => clean(t).replace(/ /g, "_"))),
  ]
    .filter((t) => t !== "")
    .map((t) => `#${t}`)
    .join(" ");
  const secondary = [camera, tags].filter((s) => s !== "").join(" · ");
  const primary = formatJst(m.timestamp);
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary: truncate(secondary) } : {}),
  };
};
