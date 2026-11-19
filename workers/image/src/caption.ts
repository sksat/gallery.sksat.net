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
  /** Shooting date and time in its own offset; absent when it has none. */
  primary?: string;
  /** Camera and tags. */
  secondary?: string;
};

/** The photo fields the caption uses (a subset of the API's photo). */
export type CaptionSource = {
  /** The platform's key, and its name (shown when given). */
  platform?: string;
  platform_name?: string;
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

const TS_RE =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/;

/**
 * The offset's name: JST for +09:00, UTC for Z, else UTC±hh:mm; none when
 * unknown (no offset, or RFC 3339's "-00:00").
 */
const zoneName = (off: string | undefined): string | null => {
  if (off === undefined || off === "-00:00") return null;
  if (off === "+09:00") return "JST";
  if (off === "Z" || off === "+00:00") return "UTC";
  return `UTC${off}`;
};

/**
 * "2023-12-16 23:12 JST": in the photo's own offset, as the gallery and its
 * photo page show it (src/components/gallery/taken.ts), never converted.
 * Null for a missing or unreadable timestamp.
 */
export const formatLocal = (timestamp: string | null): string | null => {
  const m = timestamp ? TS_RE.exec(timestamp) : null;
  if (!m) return null;
  const zone = zoneName(m[6] as string | undefined);
  const text = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return zone ? `${text} ${zone}` : text;
};

/**
 * The time a photo was taken, as precisely as the API gives it: to the
 * minute, or cut down to a date, month or year, always in the photo's own
 * offset, so the date is the one it was taken on there.
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
      return formatLocal(timestamp);
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
  const platform = m.platform_name ?? m.platform ?? "";
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
