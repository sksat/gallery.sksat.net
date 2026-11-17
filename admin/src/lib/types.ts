// Mirror of the public gallery's MediaInfoJSON / CameraJSON
// (see ../../../src/components/gallery/types.ts in the root project).
// Kept duplicated so admin remains independently buildable; review both
// when changing fields.

export type MediaWorld = "Real" | "VRChat";

export const CAMERA_KINDS = ["digital", "film", "phone", "virtual"] as const;
export type CameraKind = (typeof CAMERA_KINDS)[number];

/**
 * `camera` on a media.json item. `make`/`model` are the original fields
 * (older gallery builds read only these); `slug`/`name` link the photo to
 * its entry in cameras.json.
 */
export type MediaCamera = {
  make: string;
  model: string;
  slug: string;
  name: string;
};

export type MediaInfoJSON = {
  file: string;
  world: MediaWorld;
  timestamp: string | null;
  camera: MediaCamera | null;
  tags: string[];
};

/** Every editable camera field; create and edit both send the full set. */
export type CameraInput = {
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  /** The maker's / shop's product page (http/https). */
  product_url: string | null;
};

export type CameraRow = CameraInput & {
  id: number;
  updated_at: string;
};

/** A picture of the camera itself; `file` is a bucket path like media's. */
export type CameraImageJSON = {
  file: string;
  caption: string | null;
};

export type CameraImageRow = CameraImageJSON & {
  id: number;
  camera_id: number;
  position: number;
};

/** One item of cameras.json. `images` are in display order. */
export type CameraJSON = {
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  productUrl: string | null;
  images: CameraImageJSON[];
};

export type MediaRow = {
  id: number;
  file: string;
  world: MediaWorld;
  timestamp: string | null;
  camera_id: number | null;
  tags: string[];
  updated_at: string;
};

export type MediaPatch = {
  world?: MediaWorld;
  camera_id?: number | null;
  tags?: string[];
};
