/**
 * Caption text for the `og` card (tested with Vitest).
 *
 * The Worker looks the photo up through the API Worker and turns its
 * metadata into two short lines that Cloudflare draws as text overlays:
 *
 *   2023-12-16 23:12 JST
 *   logilabo VirtualLens2 · #VRChat
 *
 * Only public and unlisted photos get a card, and the text comes from the
 * API alone (never from the URL), so a request cannot put arbitrary text on
 * a gallery.sksat.net image or mint new transformations.
 */

export type Caption = {
  /** Shooting date and time in JST; absent when the photo has none. */
  primary?: string;
  /** Camera and tags. */
  secondary?: string;
};

/** The photo fields the caption uses (a subset of the API's photo). */
export type CaptionSource = {
  platform?: string;
  timestamp: string | null;
  /** How precisely the API gives the time (its metadata levels). */
  timestamp_precision?: string | null;
  camera: {
    name: string;
    manufacturer: string | null;
    model: string | null;
  } | null;
  tags: string[];
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

/**
 * The time a photo was taken, as precisely as the API gives it: to the
 * minute in JST, or (cut down to a date, month or year) as written, in the
 * photo's own offset, so the date is the one it was taken on there.
 */
export const formatTaken = (
  timestamp: string | null,
  precision: string | null,
): string | null => {
  if (!timestamp) return null;
  const local = /^(\d{4})-(\d\d)-(\d\d)T/.exec(timestamp);
  switch (precision) {
    case "date":
      return local ? `${local[1]}-${local[2]}-${local[3]}` : null;
    case "month":
      return local ? `${local[1]}-${local[2]}` : null;
    case "year":
      return local ? local[1] : null;
    default:
      return formatJst(timestamp);
  }
};

export const captionFor = (m: CaptionSource): Caption => {
  // "Manufacturer Model" (e.g. "logilabo VirtualLens2"); the camera's
  // display name when neither is set.
  const camera = m.camera
    ? clean(
        [m.camera.manufacturer, m.camera.model].filter(Boolean).join(" ") ||
          m.camera.name,
      )
    : "";
  // The platform is a tag too (as in the gallery's tag filter), listed
  // first. Spaces inside a tag become "_" so "#night sky" doesn't read as
  // two.
  const platform = m.platform ?? "";
  const tags = [
    ...new Set([platform, ...m.tags].map((t) => clean(t).replace(/ /g, "_"))),
  ]
    .filter((t) => t !== "")
    .map((t) => `#${t}`)
    .join(" ");
  const secondary = [camera, tags].filter((s) => s !== "").join(" · ");
  const primary = formatTaken(m.timestamp, m.timestamp_precision ?? null);
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary: truncate(secondary) } : {}),
  };
};
