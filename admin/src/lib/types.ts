import type { TagFieldLevel, TagFieldValue } from "@shared/tag-field/tag-field";
import type { MetadataOverrides } from "./metadata";
import type { MetadataSource } from "./metadata-source";
import type { ExifEdit, LocationEdit, WorldEdit } from "./photo-data";
import type { ExifJSON, FileExifJSON } from "./photo-meta";

// Admin-side shapes of the D1 rows (migrations/). The public site reads the
// same database through the API Worker (workers/api, its src/types.ts);
// review it when changing columns.

/**
 * Where a photo was taken (media.platform; "world" until migration 0005,
 * a name now kept for the VRChat world itself).
 */
export type MediaPlatform = "Real" | "VRChat";

export const PLATFORMS: readonly MediaPlatform[] = ["Real", "VRChat"];

export const isPlatform = (v: unknown): v is MediaPlatform =>
  v === "Real" || v === "VRChat";

export const CAMERA_KINDS = [
  "digital",
  "film",
  "phone",
  "virtual",
  // A device photos are digitised with (0009): media.digitized_with.
  "scanner",
] as const;
export type CameraKind = (typeof CAMERA_KINDS)[number];

/** Every editable camera field; create and edit both send the full set. */
export type CameraInput = {
  slug: string;
  name: string;
  /** Manufacturer / creator name. */
  manufacturer: string | null;
  /** The manufacturer's website (http/https). */
  manufacturer_url: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  /** The camera's product page (http/https). */
  product_url: string | null;
};

export type CameraRow = CameraInput & {
  id: number;
  updated_at: string;
};

/** A picture of the camera itself; `file` is a bucket path like media's. */
export type CameraImageRow = {
  id: number;
  camera_id: number;
  file: string;
  caption: string | null;
  position: number;
};

/**
 * Who can see a photo on the public site: `private` = nobody (the default
 * for new photos), `unlisted` = anyone with its URL but never in lists,
 * `public` = listed.
 */
export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const isVisibility = (v: unknown): v is Visibility =>
  (VISIBILITIES as readonly unknown[]).includes(v);

/**
 * SQL condition (on `media`, unqualified) for a photo the admin lists: its
 * upload completed (0004) and it is not in the trash (0005).
 */
export const LIVE_PHOTO = "status = 'ready' AND trashed_at IS NULL";

export type MediaRow = {
  id: number;
  /** Id in public URLs (/photo/<public_id>); fixed at creation. */
  public_id: string;
  /** The B2 object key: fixed, used for images. */
  file: string;
  /** Where the admin shows it (folder + name); moving rewrites it. */
  path: string;
  platform: MediaPlatform;
  timestamp: string | null;
  camera_id: number | null;
  tags: string[];
  visibility: Visibility;
  /** How much of its metadata is public: its own levels (the rest follow the site). */
  metadata_visibility: MetadataOverrides;
  /** Camera settings (media.exif; photo-data.ts). */
  exif: ExifJSON;
  /** Where it was taken (both or neither), and where that came from. */
  latitude: number | null;
  longitude: number | null;
  location_source: "exif" | "manual" | null;
  /** The VRChat world; the author is admin only. */
  world_id: string | null;
  world_name: string | null;
  world_author_id: string | null;
  /** When it went to the trash; null when it is not there. */
  trashed_at: string | null;
  /** Where the taken-at time, exif and world came from (0008). */
  metadata_source: MetadataSource;
  /** The file's own EXIF as read (0009; admin only, never public). */
  file_exif: FileExifJSON | null;
  /** When it was digitised (スキャン日時), from a scanner's EXIF. */
  digitized_at: string | null;
  /** The camera row it was digitised with (スキャン機材). */
  digitized_with: number | null;
  /** Served images carry its public info as EXIF; null = the site's. */
  embed_exif: boolean | null;
  /** Its values of tag fields (0010): field id → value, as stored. */
  tag_values: Record<string, unknown>;
  /** Its own public levels for them: field id → level. */
  tag_value_visibility: Record<string, TagFieldLevel>;
  updated_at: string;
};

export type MediaPatch = {
  /**
   * Camera settings (photo-data.ts EXIF_EDIT_KEYS): a key set or cleared
   * (null); keys left out are kept.
   */
  exif?: ExifEdit;
  /** Null clears; a changed position becomes location_source 'manual'. */
  location?: LocationEdit;
  /** The world's id and/or name; a part left out is kept. */
  world?: WorldEdit;
  /**
   * Fields to set back to what the original says: emptied, no longer
   * 'manual', and read again from the file.
   */
  reset_from_file?: ("exif" | "world" | "location" | "taken_at")[];
  /** The taken-at time (ISO 8601 with offset) or null; becomes 'manual'. */
  timestamp?: string | null;
  platform?: MediaPlatform;
  camera_id?: number | null;
  /** The device it was digitised with; becomes 'manual' (also cleared). */
  digitized_with?: number | null;
  /** True / false, or null to follow the site. */
  embed_exif?: boolean | null;
  tags?: string[];
  visibility?: Visibility;
  /** Replaces the photo's overrides ({} = all from the site). */
  metadata_visibility?: MetadataOverrides;
  /**
   * Tag field values by field id: a value sets, null clears; ids left out
   * are kept. Checked against the fields (db-tag-field.ts) before storing.
   */
  tag_values?: Record<string, TagFieldValue | null>;
  /** The photo's own levels by field id; null = the field's default. */
  tag_value_visibility?: Record<string, TagFieldLevel | null>;
};
