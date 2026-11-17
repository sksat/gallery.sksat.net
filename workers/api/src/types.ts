/**
 * Response bodies of the public API, read by the gallery
 * (src/components/gallery/types.ts) and the image Worker. Review those
 * when changing fields.
 */

/** `camera` on a photo: enough to label it and link to /camera/<slug>/. */
export type MediaCameraJSON = {
  slug: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
};

/** One photo. `id` is its public id (/photo/<id>). */
export type MediaItemJSON = {
  id: string;
  file: string;
  world: "Real" | "VRChat";
  timestamp: string | null;
  camera: MediaCameraJSON | null;
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
