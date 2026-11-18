/**
 * The EXIF a public image carries (tested with Vitest): built only from
 * the photo as the API returns it, i.e. already cut down to the levels the
 * owner chose (workers/api/src/metadata.ts). The originals' own metadata
 * never reaches the output (Image Transformations runs with
 * `metadata: "none"`), so a hidden field cannot leak through it.
 *
 * - Make / Model / LensModel: the camera, as far as its level allows
 *   (manufacturer only: Make only). LensModel only with the full camera,
 *   and only when the exif level gives the lens.
 * - DateTimeOriginal + OffsetTimeOriginal: the time it was taken, at its
 *   precision. EXIF allows unknown parts of a date to be blank, so a
 *   coarser level writes only what it shows: "2026:11:18 01:02:  " at
 *   minute, "2026:11:18   :  :  " at date, "2026:11:     :  :  " at month,
 *   "2026:  :     :  :  " at year. Readers that cannot parse a partial
 *   date ignore it rather than show a made-up time.
 * - FNumber / ExposureTime / ISOSpeedRatings / FocalLength: the exif level.
 * - GPS: the location level, rounded as the API rounds it (the rational's
 *   denominator keeps that precision; no false digits).
 * - ImageDescription: the VRChat world's name (world level).
 * - Never Orientation: Image Transformations has already turned the
 *   pixels upright, so the original's orientation would rotate it again.
 */
import { TAG, type ExifIfds, type ExifValue } from "./exif-encode";

/** The photo fields used here (a subset of the API's MediaItemJSON). */
export type PublicMeta = {
  timestamp?: string | null;
  timestamp_precision?: string | null;
  camera?: {
    slug?: string | null;
    manufacturer: string | null;
    model: string | null;
  } | null;
  exif?: {
    lens?: string;
    focal_length_mm?: number;
    f_number?: number;
    exposure_time?: string;
    iso?: number;
  } | null;
  location?: {
    latitude: number;
    longitude: number;
    precision: string;
  } | null;
  world?: { id?: string; name: string | null } | null;
};

const ascii = (value: string): ExifValue => ({ type: "ascii", value });

const text = (s: string | null | undefined, max = 200): string | null => {
  // Control characters out (NUL would end the value early).
  const t = (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

const TS_RE =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/;

/**
 * DateTimeOriginal (blank where the precision hides it) and its offset
 * (null for an old timestamp recorded without one); null when there is
 * no usable time.
 */
export const exifDateTime = (
  timestamp: string | null | undefined,
  precision: string | null | undefined,
): { dateTime: string; offset: string | null } | null => {
  const m = timestamp ? TS_RE.exec(timestamp) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", off] = m;
  const offset = off === undefined ? null : off === "Z" ? "+00:00" : off;
  const parts: Record<string, string> = {
    second: `${y}:${mo}:${d} ${h}:${mi}:${s}`,
    minute: `${y}:${mo}:${d} ${h}:${mi}:  `,
    date: `${y}:${mo}:${d}   :  :  `,
    month: `${y}:${mo}:     :  :  `,
    year: `${y}:  :     :  :  `,
  };
  const dateTime = parts[precision ?? ""];
  return dateTime ? { dateTime, offset } : null;
};

/** A positive decimal as a rational with `digits` decimals kept. */
const rational = (v: number, digits: number): [number, number] => {
  const den = 10 ** digits;
  return [Math.round(v * den), den];
};

/** "1/250", "2", "0.5" as a rational; null if unreadable. */
export const exposureRational = (s: string): [number, number] | null => {
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const [a, b] = [Number(frac[1]), Number(frac[2])];
    return a > 0 && b > 0 && a <= 0xffffffff && b <= 0xffffffff ? [a, b] : null;
  }
  const n = Number(s);
  if (!/^\d+(\.\d+)?$/.test(s) || !(n > 0) || n > 100000) return null;
  return rational(n, 4);
};

/** Decimals the API keeps at each location level (metadata.ts). */
const LOCATION_DECIMALS: Record<string, number> = {
  exact: 5,
  city: 2,
  prefecture: 1,
  country: 0,
};

const positive = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;

/** The EXIF tags for a photo's public metadata (empty IFDs if none). */
export const publicExif = (p: PublicMeta): ExifIfds => {
  const ifd0 = new Map<number, ExifValue>();
  const exif = new Map<number, ExifValue>();
  const gps = new Map<number, ExifValue>();

  const make = text(p.camera?.manufacturer);
  const model = text(p.camera?.model);
  if (make) ifd0.set(TAG.make, ascii(make));
  if (model) ifd0.set(TAG.model, ascii(model));
  // The full camera (with its page) is shown at the "model" level only.
  const lens = p.camera?.slug ? text(p.exif?.lens) : null;
  if (lens) exif.set(TAG.lensModel, ascii(lens));

  const world = text(p.world?.name);
  if (world) ifd0.set(TAG.imageDescription, ascii(world));

  const when = exifDateTime(p.timestamp, p.timestamp_precision);
  if (when) {
    exif.set(TAG.dateTimeOriginal, ascii(when.dateTime));
    if (when.offset) exif.set(TAG.offsetTimeOriginal, ascii(when.offset));
  }

  const e = p.exif;
  if (positive(e?.f_number, 1000)) {
    exif.set(TAG.fNumber, {
      type: "rational",
      value: [rational(e.f_number, 2)],
    });
  }
  const exposure = e?.exposure_time ? exposureRational(e.exposure_time) : null;
  if (exposure)
    exif.set(TAG.exposureTime, { type: "rational", value: [exposure] });
  if (positive(e?.iso, Infinity)) {
    exif.set(TAG.iso, {
      type: "short",
      value: [Math.min(Math.round(e.iso), 0xffff)],
    });
  }
  if (positive(e?.focal_length_mm, 100000)) {
    exif.set(TAG.focalLength, {
      type: "rational",
      value: [rational(e.focal_length_mm, 2)],
    });
  }
  if (exif.size > 0) {
    exif.set(TAG.exifVersion, {
      type: "undefined",
      value: new TextEncoder().encode("0232"),
    });
  }

  const loc = p.location;
  const digits = loc ? LOCATION_DECIMALS[loc.precision] : undefined;
  if (
    loc &&
    digits !== undefined &&
    Math.abs(loc.latitude) <= 90 &&
    Math.abs(loc.longitude) <= 180
  ) {
    // Degrees only, with the API's rounding as the denominator.
    const deg = (v: number): ExifValue => ({
      type: "rational",
      value: [rational(Math.abs(v), digits), [0, 1], [0, 1]],
    });
    gps.set(TAG.gpsVersionId, {
      type: "byte",
      value: Uint8Array.of(2, 3, 0, 0),
    });
    gps.set(TAG.gpsLatitudeRef, ascii(loc.latitude < 0 ? "S" : "N"));
    gps.set(TAG.gpsLatitude, deg(loc.latitude));
    gps.set(TAG.gpsLongitudeRef, ascii(loc.longitude < 0 ? "W" : "E"));
    gps.set(TAG.gpsLongitude, deg(loc.longitude));
  }
  return { ifd0, exif, gps };
};
