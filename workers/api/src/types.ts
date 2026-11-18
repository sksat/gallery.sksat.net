/**
 * Response bodies of the public API, read by the gallery
 * (src/components/gallery/types.ts) and the image Worker. Review those
 * when changing fields.
 */

/**
 * `camera` on a photo. At the "model" level: the camera, linked to
 * /camera/<slug>/. At "manufacturer": the maker only (`slug` and `model`
 * null, `name` the maker), so no camera page.
 */
export type MediaCameraJSON = {
  slug: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
};

/** How precisely `timestamp` is given (metadata.ts, taken_at). */
export type TimestampPrecision =
  "second" | "minute" | "date" | "month" | "year";

/**
 * One photo. `id` is its public id (/photo/<id>). Each piece of metadata
 * is cut down to what the photo's metadata visibility allows
 * (metadata.ts): a hidden one is null (tags: empty).
 */
export type MediaItemJSON = {
  id: string;
  /**
   * The bucket path, only when the file name is public with its folder
   * ("path") and the photo has not been moved (its display path is still
   * the bucket path), so /img/<preset>/<file> works; else null. Images go
   * by `id` anyway.
   */
  file: string | null;
  /** The admin's display path (folder + name), at the "path" level. */
  path: string | null;
  /** The file name without its folder, at "path" or "name". */
  name: string | null;
  /** Where the photo was taken (admin media.platform). */
  platform: "Real" | "VRChat";
  /** ISO 8601 in the photo's own offset, cut to `timestamp_precision`. */
  timestamp: string | null;
  timestamp_precision: TimestampPrecision | null;
  camera: MediaCameraJSON | null;
  /** Only the tags marked public (admin `tag` table). */
  tags: string[];
};

export type CameraKind = "digital" | "film" | "phone" | "virtual";

export type CameraImageJSON = {
  file: string;
  caption: string | null;
};

/** One camera; `images` in display order. */
export type CameraJSON = {
  slug: string;
  name: string;
  manufacturer: string | null;
  manufacturerUrl: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  productUrl: string | null;
  images: CameraImageJSON[];
};
