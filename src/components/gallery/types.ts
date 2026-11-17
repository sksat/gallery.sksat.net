// Photo and camera types, as served by the API Worker (workers/api, see its
// src/types.ts) and as used at runtime.
export type MediaWorld = "VRChat" | "Real";

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

/** One photo from /api/media. `id` is its public id (/photo/<id>). */
export type MediaInfoJSON = {
  id: string;
  file: string;
  world: MediaWorld;
  timestamp: null | string;
  camera: null | MediaCamera;
  tags: string[];
};

export type MediaInfo = {
  id: string;
  file: string;
  world: MediaWorld;
  timestamp: null | Date;
  camera: null | MediaCamera;
  tags: string[];
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
});

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
  const { id, file, world, timestamp, camera, tags } = v;
  if (typeof id !== "string" || !PUBLIC_ID_RE.test(id)) return null;
  if (
    typeof file !== "string" ||
    !/^(\/[A-Za-z0-9._-]+)+$/.test(file) ||
    /\/\.{1,2}(\/|$)/.test(file)
  ) {
    return null;
  }
  if (world !== "Real" && world !== "VRChat") return null;
  let cam: MediaCamera | null = null;
  if (isRecord(camera) && typeof camera.slug === "string") {
    cam = {
      slug: camera.slug,
      name: strOrNull(camera.name) ?? camera.slug,
      manufacturer: strOrNull(camera.manufacturer),
      model: strOrNull(camera.model),
    };
  }
  return {
    id,
    file,
    world,
    timestamp: typeof timestamp === "string" ? timestamp : null,
    camera: cam,
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
