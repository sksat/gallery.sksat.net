// What the photo info panel (info-panel.tsx) shows, as plain values. Every
// function reads only what the API returned for the photo: a field it left
// out (null) stays out, and nothing is guessed from another field.
import { cameraHref, cameraLabel, cameraSlug } from "./cameras";
import { mediaTags } from "./tags";
import type {
  MediaExif,
  MediaInfo,
  MediaLocation,
  MediaWorld,
  TimestampPrecision,
} from "./types";

const TS_PARTS =
  /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/;

/** When a photo was taken: display text and a `<time datetime>` value. */
export type TakenAt = { text: string; datetime: string };

/**
 * The time a photo was taken, as precisely as the API gives it and in the
 * photo's own offset (as written in the timestamp, not the viewer's time
 * zone): 2023/12/16 23:12 (to the second or minute), 2023/12/16, 2023/12
 * or 2023. A missing precision is read as "second" (the API before it had
 * levels). Null when there is no time or it cannot be read.
 */
export const takenAt = (
  timestamp: string | null,
  precision: TimestampPrecision | null | undefined,
): TakenAt | null => {
  if (!timestamp) return null;
  const m = TS_PARTS.exec(timestamp);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  // Optional in the pattern: undefined when the time has no offset.
  const off = m[6] as string | undefined;
  switch (precision) {
    case "year":
      return { text: y, datetime: y };
    case "month":
      return { text: `${y}/${mo}`, datetime: `${y}-${mo}` };
    case "date":
      return { text: `${y}/${mo}/${d}`, datetime: `${y}-${mo}-${d}` };
    default:
      return {
        text: `${y}/${mo}/${d} ${h}:${mi}`,
        datetime: `${y}-${mo}-${d}T${h}:${mi}${off ?? ""}`,
      };
  }
};

/** A number without trailing zeros, to at most `digits` decimals. */
const short = (n: number, digits: number) => {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
};

/**
 * How the photo was exposed, as one line: 「f/2.8 · 1/250 s · ISO 100 ·
 * 35 mm」, with only the values the API gave. Null when there are none.
 */
export const exposureLine = (
  exif: MediaExif | null | undefined,
): string | null => {
  if (!exif) return null;
  const parts = [
    exif.f_number !== undefined && `f/${short(exif.f_number, 2)}`,
    exif.exposure_time !== undefined && `${exif.exposure_time} s`,
    exif.iso !== undefined && `ISO ${short(exif.iso, 0)}`,
    exif.focal_length_mm !== undefined &&
      `${short(exif.focal_length_mm, 1)} mm`,
  ].filter((p): p is string => typeof p === "string");
  return parts.length > 0 ? parts.join(" · ") : null;
};

/**
 * The camera body as EXIF names it ("all" level): make and model, without
 * repeating the make when the model already starts with it ("Canon" +
 * "Canon EOS R5" → "Canon EOS R5").
 */
export const exifBody = (exif: MediaExif | null | undefined): string | null => {
  if (!exif) return null;
  const { make, model } = exif;
  if (make && model) {
    return model.toLowerCase().startsWith(make.toLowerCase())
      ? model
      : `${make} ${model}`;
  }
  return make ?? model ?? null;
};

/** The world's page on vrchat.com, when the API gave its id. */
export const worldHref = (world: MediaWorld | null | undefined) =>
  world?.id
    ? `https://vrchat.com/home/world/${encodeURIComponent(world.id)}`
    : null;

/**
 * Where a location links to. The gallery has no map page yet, so the
 * panel leaves the location out; return its URL here once there is one.
 */
export const mapHref = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _location: MediaLocation | null | undefined,
): string | null => null;

/**
 * The camera row: a link to its page, or the maker as text. Never the
 * EXIF body: when the API leaves the camera out, so does the panel.
 */
export type CameraInfo = { label: string; href: string | null };

export const cameraInfo = (m: MediaInfo): CameraInfo | null => {
  if (m.camera) {
    return {
      label: cameraLabel(m.camera),
      href: cameraHref(cameraSlug(m.camera)),
    };
  }
  return m.maker ? { label: m.maker, href: null } : null;
};

/** Everything the panel shows for a photo; null fields are left out. */
export type PhotoInfo = {
  taken: TakenAt | null;
  camera: CameraInfo | null;
  /** The EXIF body, when it is not already the camera row. */
  body: string | null;
  lens: string | null;
  exposure: string | null;
  world: { name: string; href: string | null } | null;
  location: { href: string } | null;
  tags: string[];
  /** The display path, else the file name. */
  file: string | null;
};

export const photoInfo = (m: MediaInfo): PhotoInfo => {
  const camera = cameraInfo(m);
  const body = exifBody(m.exif);
  const world =
    m.world && (m.world.name || m.world.id)
      ? {
          name: (m.world.name ?? m.world.id) as string,
          href: worldHref(m.world),
        }
      : null;
  const map = m.location ? mapHref(m.location) : null;
  return {
    taken: takenAt(m.takenIso ?? null, m.timestamp_precision),
    camera,
    // Only next to a camera shown as a model (the API gives the body only
    // then, too).
    body: m.camera && body !== null && body !== camera?.label ? body : null,
    lens: m.exif?.lens ?? null,
    exposure: exposureLine(m.exif),
    world,
    location: map ? { href: map } : null,
    tags: mediaTags(m),
    file: m.path ?? m.name ?? null,
  };
};

/** Whether the panel has anything besides the tags to show. */
export const hasDetails = (info: PhotoInfo): boolean =>
  Boolean(
    info.taken ||
    info.camera ||
    info.body ||
    info.lens ||
    info.exposure ||
    info.world ||
    info.location ||
    info.file,
  );

/** The one-line summary on a phone: 「2023/12/16 23:12 · VirtualLens2」. */
export const infoSummary = (info: PhotoInfo): string | null => {
  const parts = [info.taken?.text, info.camera?.label].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
};
