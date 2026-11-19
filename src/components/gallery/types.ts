// Photo and camera types, as served by the API Worker (workers/api, see its
// src/types.ts) and as used at runtime.
import { takenDateKey } from "@shared/calendar/calendar";
import {
  isLatLng,
  LOCATION_DECIMALS,
  type LocationPrecision,
} from "@shared/map/map";

import { takenAt } from "./taken";

/** Where a photo was taken (the API's `platform`). */
export type MediaPlatform = "VRChat" | "Real";

/** `camera` on a photo: enough to label it and link to /camera/<slug>/. */
export type MediaCamera = {
  slug: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
};

export type CameraKind = "digital" | "film" | "phone" | "virtual";

/** One camera from /api/camera. */
export type CameraJSON = {
  slug: string;
  name: string;
  /** Manufacturer / creator name. */
  manufacturer: string | null;
  /** The manufacturer's website (http/https). */
  manufacturerUrl: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  /** The camera's product page (http/https). */
  productUrl: string | null;
  /** Pictures of the camera itself, in display order (bucket paths). */
  images: CameraImageJSON[];
};

export type CameraImageJSON = {
  file: string;
  caption: string | null;
};

/** How precisely the API gives the time a photo was taken. */
export type TimestampPrecision =
  "second" | "minute" | "date" | "month" | "year";

/**
 * Camera settings as the API gives them (workers/api/src/metadata.ts,
 * ExifJSON): at "basic" the exposure only, at "all" the body and lens too.
 * `orientation` and `taken_at_original` are not read: the latter would
 * show the time more precisely than `timestamp` may.
 */
export type MediaExif = {
  make?: string;
  model?: string;
  lens?: string;
  focal_length_mm?: number;
  f_number?: number;
  /** As photographers write it: "1/250", "2", "0.5". */
  exposure_time?: string;
  iso?: number;
};

/** The VRChat world: with its id at the "link" level, else the name only. */
export type MediaWorld = { id: string | null; name: string | null };

/**
 * One photo from /api/media. `id` is its public id (/photo/<id>). The API
 * leaves out (null) what the photo's metadata settings do not make public.
 */
export type MediaInfoJSON = {
  id: string;
  /** Bucket path; null unless the file name is public with its folder. */
  file: string | null;
  /** The display path (folder + name), at the "path" level. */
  path?: string | null;
  /** The file name, without its folder. */
  name?: string | null;
  platform: MediaPlatform;
  timestamp: null | string;
  timestamp_precision?: TimestampPrecision | null;
  /** The camera, with its page. */
  camera: null | MediaCamera;
  /** Only the camera's maker is public (no camera page). */
  maker?: string | null;
  world?: MediaWorld | null;
  exif?: MediaExif | null;
  /**
   * Where it was taken, rounded to its public precision (the API's
   * `location`); null when hidden or unknown, and always for VRChat.
   */
  location?: MediaLocation | null;
  tags: string[];
};

/** A photo's public position, rounded to its level (workers/api, locationAt). */
export type MediaLocation = {
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
};

export type MediaInfo = Omit<MediaInfoJSON, "timestamp"> & {
  timestamp: null | Date;
  /** The time it was taken, as precisely as it is public, for display. */
  takenText?: string | null;
  /** `timestamp` as the API wrote it (in the photo's own offset). */
  takenIso?: string | null;
  /**
   * The date it was taken in its own offset, as precisely as it is public
   * ("2023-12-04", "2023-12" or "2023"): the calendar's `?date=` filter.
   */
  takenDate?: string | null;
};

/**
 * Display text for when a photo was taken (the grid captions): the same
 * text as everywhere else on the site, in the photo's own offset
 * (taken.ts).
 */
export const formatTaken = (
  timestamp: string | null,
  precision: TimestampPrecision | null,
): string | null => takenAt(timestamp, precision)?.text ?? null;

export type MediaIndex = MediaInfo[];

/** A photo's public id (admin/migrations/0003_visibility.sql). */
export const PUBLIC_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

/**
 * Parse a timestamp string into a Date object.
 * Returns null if the timestamp is null or invalid.
 *
 * @param timestamp - ISO 8601 timestamp string or null
 * @returns Date object or null
 */
export const parseMediaTimestamp = (timestamp: string | null): Date | null => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? null : date;
};

/**
 * Transform MediaInfoJSON (from the API) to MediaInfo (runtime type).
 * Converts timestamp string to Date object.
 */
export const transformMediaInfo = (item: MediaInfoJSON): MediaInfo => ({
  ...item,
  timestamp: parseMediaTimestamp(item.timestamp),
  takenText: formatTaken(item.timestamp, item.timestamp_precision ?? null),
  takenIso: item.timestamp,
  takenDate: takenDateKey(item.timestamp, item.timestamp_precision),
});

const PRECISIONS: readonly string[] = [
  "second",
  "minute",
  "date",
  "month",
  "year",
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

const finiteOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A VRChat world id; it goes into a vrchat.com URL. */
const WORLD_ID_RE = /^wrld_[A-Za-z0-9-]+$/;

const parseWorld = (v: unknown): MediaWorld | null => {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && WORLD_ID_RE.test(v.id) ? v.id : null;
  const name = strOrNull(v.name);
  return id || name ? { id, name } : null;
};

const EXIF_STRINGS = ["make", "model", "lens", "exposure_time"] as const;
const EXIF_NUMBERS = ["focal_length_mm", "f_number", "iso"] as const;

const parseExif = (v: unknown): MediaExif | null => {
  if (!isRecord(v)) return null;
  const out: MediaExif = {};
  for (const key of EXIF_STRINGS) {
    const s = strOrNull(v[key]);
    if (s !== null) out[key] = s;
  }
  for (const key of EXIF_NUMBERS) {
    const n = finiteOrNull(v[key]);
    if (n !== null && n > 0) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
};

/**
 * One photo from an API response, or null if it is malformed. The id and
 * file end up in URLs, so both are checked for shape.
 */
export const parseMediaItem = (v: unknown): MediaInfoJSON | null => {
  if (!isRecord(v)) return null;
  const { id, file, timestamp, camera, tags, platform } = v;
  if (typeof id !== "string" || !PUBLIC_ID_RE.test(id)) return null;
  // null: the file name is not public (images go by id).
  if (
    file !== null &&
    (typeof file !== "string" ||
      !/^(\/[A-Za-z0-9._-]+)+$/.test(file) ||
      /\/\.{1,2}(\/|$)/.test(file))
  ) {
    return null;
  }
  if (platform !== "Real" && platform !== "VRChat") return null;
  let cam: MediaCamera | null = null;
  let maker: string | null = null;
  if (isRecord(camera) && typeof camera.slug === "string") {
    cam = {
      slug: camera.slug,
      name: strOrNull(camera.name) ?? camera.slug,
      manufacturer: strOrNull(camera.manufacturer),
      model: strOrNull(camera.model),
    };
  } else if (isRecord(camera)) {
    // Only the maker is public: no camera page to link to.
    maker = strOrNull(camera.manufacturer) ?? strOrNull(camera.name);
  }
  const precision = v.timestamp_precision;
  return {
    id,
    file,
    path: strOrNull(v.path),
    name: strOrNull(v.name),
    platform,
    timestamp: typeof timestamp === "string" ? timestamp : null,
    timestamp_precision:
      typeof precision === "string" && PRECISIONS.includes(precision)
        ? (precision as TimestampPrecision)
        : null,
    camera: cam,
    maker,
    world: parseWorld(v.world),
    exif: parseExif(v.exif),
    // A VRChat photo has no real-world position: never keep one.
    location: platform === "VRChat" ? null : parseLocation(v.location),
    tags: Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string")
      : [],
  };
};

/**
 * `location` from the API: a valid position at a known precision, rounded
 * to that precision again so the page never shows more than it says.
 */
export const parseLocation = (v: unknown): MediaLocation | null => {
  if (!isRecord(v)) return null;
  const { latitude, longitude, precision } = v;
  if (!isLatLng(latitude, longitude)) return null;
  if (
    typeof precision !== "string" ||
    !Object.prototype.hasOwnProperty.call(LOCATION_DECIMALS, precision)
  ) {
    return null;
  }
  const p = precision as LocationPrecision;
  const f = 10 ** LOCATION_DECIMALS[p];
  const round = (x: number) => Math.round(x * f) / f + 0;
  return {
    latitude: round(latitude as number),
    longitude: round(longitude as number),
    precision: p,
  };
};

/** The photos in an API list response; malformed entries are dropped. */
export const parseMediaList = (data: unknown): MediaInfoJSON[] =>
  Array.isArray(data)
    ? data.flatMap((v) => {
        const m = parseMediaItem(v);
        return m ? [m] : [];
      })
    : [];
