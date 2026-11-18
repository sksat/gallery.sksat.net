// Photo and camera types, as served by the API Worker (workers/api, see its
// src/types.ts) and as used at runtime.
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
 * One photo from /api/media. `id` is its public id (/photo/<id>). The API
 * leaves out (null) what the photo's metadata settings do not make public.
 */
export type MediaInfoJSON = {
  id: string;
  /** Bucket path; null unless the file name is public with its folder. */
  file: string | null;
  /** The file name, without its folder. */
  name?: string | null;
  platform: MediaPlatform;
  timestamp: null | string;
  timestamp_precision?: TimestampPrecision | null;
  /** The camera, with its page. */
  camera: null | MediaCamera;
  /** Only the camera's maker is public (no camera page). */
  maker?: string | null;
  tags: string[];
};

export type MediaInfo = Omit<MediaInfoJSON, "timestamp"> & {
  timestamp: null | Date;
  /** The time it was taken, as precisely as it is public, for display. */
  takenText?: string | null;
};

const TAKEN_PARTS = /^(\d{4})-(\d\d)-(\d\d)T/;

/**
 * Display text for when a photo was taken: to the second (as before) or
 * minute in the viewer's locale, or cut to a date, month or year as the
 * API wrote it (in the photo's own offset, so its date is unchanged).
 */
export const formatTaken = (
  timestamp: string | null,
  precision: TimestampPrecision | null,
): string | null => {
  const date = parseMediaTimestamp(timestamp);
  if (!date || !timestamp) return null;
  const parts = TAKEN_PARTS.exec(timestamp);
  switch (precision) {
    case "year":
      return parts ? parts[1] : null;
    case "month":
      return parts ? `${parts[1]}/${parts[2]}` : null;
    case "date":
      return parts ? `${parts[1]}/${parts[2]}/${parts[3]}` : null;
    case "minute":
      return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    default:
      return date.toLocaleString("ja-JP");
  }
};

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
    name: strOrNull(v.name),
    platform,
    timestamp: typeof timestamp === "string" ? timestamp : null,
    timestamp_precision:
      typeof precision === "string" && PRECISIONS.includes(precision)
        ? (precision as TimestampPrecision)
        : null,
    camera: cam,
    maker,
    tags: Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string")
      : [],
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
