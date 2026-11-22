// The camera list's hover card (routes/camera/index.tsx): a camera's first
// picture and its newest photos, read when the card is first shown
// (GET /api/camera/<id>/preview). Two small queries by camera id: its
// pictures by idx_camera_image_camera (it has a few), its photos by
// idx_media_camera_id (the rows read are that camera's photos).
import { LIVE_PHOTO, type MediaPlatform } from "./types";

/** How many of a camera's newest photos its card shows. */
export const PREVIEW_PHOTOS = 4;

export type CameraPreview = {
  /** Its first picture: its own object (`exact`), or a photo's file. */
  picture: { file: string; exact: boolean } | null;
  /** Its newest listed photos, newest first (undated last). */
  photos: { id: number; file: string; platform: MediaPlatform }[];
};

export const cameraPreview = async (
  db: D1Database,
  cameraId: number,
): Promise<CameraPreview> => {
  const [pictures, photos] = await db.batch([
    db
      .prepare(
        `SELECT i.file, m.file AS photo_file
         FROM camera_image i LEFT JOIN media m ON m.id = i.media_id
         WHERE i.camera_id = ? ORDER BY i.position, i.id LIMIT 1`,
      )
      .bind(cameraId),
    db
      .prepare(
        `SELECT id, file, platform FROM media
         WHERE camera_id = ? AND ${LIVE_PHOTO}
         ORDER BY timestamp IS NULL, timestamp DESC, id DESC LIMIT ?`,
      )
      .bind(cameraId, PREVIEW_PHOTOS),
  ]);
  const first = (pictures.results ?? [])[0] as
    { file: string | null; photo_file: string | null } | undefined;
  return {
    picture: first?.file
      ? { file: first.file, exact: true }
      : first?.photo_file
        ? { file: first.photo_file, exact: false }
        : null,
    photos: (photos.results ?? []) as CameraPreview["photos"],
  };
};

/** The route's answer as a preview, or null when it is not one. */
export const parseCameraPreview = (value: unknown): CameraPreview | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const pic = v.picture as Record<string, unknown> | null | undefined;
  const picture =
    pic && typeof pic.file === "string"
      ? { file: pic.file, exact: pic.exact === true }
      : null;
  if (!Array.isArray(v.photos)) return null;
  const photos = v.photos.flatMap((p) => {
    const o = p as Record<string, unknown> | null;
    return o &&
      typeof o.id === "number" &&
      typeof o.file === "string" &&
      typeof o.platform === "string"
      ? [{ id: o.id, file: o.file, platform: o.platform }]
      : [];
  });
  return { picture, photos };
};
