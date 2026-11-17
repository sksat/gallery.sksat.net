// media.json type definitions
export type MediaWorld = "VRChat" | "Real";

export type MediaCamera = {
  make: string;
  model: string;
  /** Key into cameras.json (`/camera/<slug>/`). Absent in older media.json. */
  slug?: string;
  /** Display name from cameras.json. Absent in older media.json. */
  name?: string;
};

export type CameraKind = "digital" | "film" | "phone" | "virtual";

/** One item of cameras.json (published next to media.json by the admin). */
export type CameraJSON = {
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  /** The maker's / shop's product page (http/https). */
  productUrl: string | null;
  /** Pictures of the camera itself, in display order (bucket paths). */
  images: CameraImageJSON[];
};

export type CameraImageJSON = {
  file: string;
  caption: string | null;
};

export type MediaInfoJSON = {
  file: string;
  world: MediaWorld;
  timestamp: null | string;
  camera: null | MediaCamera;
  tags: string[];
};

export type MediaInfo = {
  file: string;
  world: MediaWorld;
  timestamp: null | Date;
  camera: null | MediaCamera;
  tags: string[];
};

export type MediaIndex = MediaInfo[];

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
 * Transform MediaInfoJSON (from media.json) to MediaInfo (runtime type).
 * Converts timestamp string to Date object.
 *
 * @param item - MediaInfoJSON from media.json
 * @returns MediaInfo with parsed timestamp
 */
export const transformMediaInfo = (item: MediaInfoJSON): MediaInfo => ({
  ...item,
  timestamp: parseMediaTimestamp(item.timestamp),
});
