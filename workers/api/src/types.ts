import type { PublicTagField } from "../../../shared/tag-field/tag-field";
import type { ExifJSON } from "./metadata";

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

/** A coarse or exact position (metadata.ts, locationAt). */
export type MediaWorldJSON = { id?: string; name: string | null };

export type MediaLocationJSON = {
  latitude: number;
  longitude: number;
  precision: "exact" | "city" | "prefecture" | "country";
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
  /**
   * The device it was digitised with (スキャン機材: a scanner, or a camera
   * used to copy an analog original), like `camera` at its own level
   * (hidden by default). `camera` stays the camera it was shot with.
   */
  digitizer: MediaCameraJSON | null;
  /** When it was digitised, cut to its level (hidden by default). */
  digitized_at: string | null;
  digitized_at_precision: TimestampPrecision | null;
  /**
   * Where it was taken, as precisely as its `location` level allows:
   * "exact" to 5 decimals (about 1 m); "city", "prefecture" and "country"
   * only as a coarse position (2, 1 and 0 decimals) with no place name
   * yet (reverse geocoding comes later). Null when hidden (the default)
   * or unknown, and always for VRChat photos.
   */
  location: MediaLocationJSON | null;
  /**
   * The VRChat world: at "link" its id (https://vrchat.com/home/world/<id>)
   * and name, at "name" the name only. Null when hidden or unknown.
   */
  world: MediaWorldJSON | null;
  /**
   * Camera settings: at "all" every known one (ExifJSON), at "basic"
   * (the default) f_number, exposure_time, iso and focal_length_mm. Null
   * when hidden or unknown.
   */
  exif: ExifJSON | null;
  /**
   * Whether the photo's served images carry this public information as
   * EXIF (the photo's choice, else the site's; the image Worker reads it).
   */
  embed_exif: boolean;
  /** Only the tags marked public (admin `tag` table). */
  tags: string[];
  /**
   * Values of the fields of those tags (admin `tag_field`, 0010), each
   * shown on this photo: by tag in `tags` order, then the field's order.
   * Empty when there are none, or the tags are hidden.
   */
  tag_fields: PublicTagField[];
};

export type CameraKind = "digital" | "film" | "phone" | "virtual" | "scanner";

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
