// media.json type definitions
export type MediaWorld = "VRChat" | "Real";

export type MediaCamera = {
  make: string;
  model: string;
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
