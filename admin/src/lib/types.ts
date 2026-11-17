// Admin-side shapes of the D1 rows (migrations/). The public site reads the
// same database through the API Worker (workers/api, its src/types.ts);
// review it when changing columns.

export type MediaWorld = "Real" | "VRChat";

export const CAMERA_KINDS = ["digital", "film", "phone", "virtual"] as const;
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
  world: MediaWorld;
  timestamp: string | null;
  camera_id: number | null;
  tags: string[];
  visibility: Visibility;
  /** N of the old /photo/<N> URL, for photos that had one. */
  legacy_index: number | null;
  updated_at: string;
};

export type MediaPatch = {
  world?: MediaWorld;
  camera_id?: number | null;
  tags?: string[];
  visibility?: Visibility;
};
