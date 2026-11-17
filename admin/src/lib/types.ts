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

/** One item of cameras.json. */
export type CameraJSON = {
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  kind: CameraKind | null;
  description: string | null;
  url: string | null;
};

export type CameraRow = CameraJSON & {
  id: number;
  updated_at: string;
};

/** Every editable camera field; create and edit both send the full set. */
export type CameraInput = CameraJSON;

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
