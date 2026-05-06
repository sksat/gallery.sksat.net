// Mirror of the public gallery's MediaInfoJSON
// (see ../../../src/components/gallery/types.ts in the root project).
// Kept duplicated so admin remains independently buildable; review both
// when changing fields.

export type MediaWorld = "Real" | "VRChat";

export type MediaCamera = {
  make: string;
  model: string;
};

export type MediaInfoJSON = {
  file: string;
  world: MediaWorld;
  timestamp: string | null;
  camera: MediaCamera | null;
  tags: string[];
};

export type MediaRow = {
  id: number;
  file: string;
  world: MediaWorld;
  timestamp: string | null;
  camera_make: string | null;
  camera_model: string | null;
  tags: string[];
  updated_at: string;
};

export type MediaPatch = {
  world?: MediaWorld;
  camera_make?: string | null;
  camera_model?: string | null;
  tags?: string[];
};
