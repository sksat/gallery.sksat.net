/**
 * The last-good snapshot: everything the API answers, in one value, so
 * the public site survives a D1 outage (for instance the Free plan's
 * daily row-read limit, which fails every query until 00:00 UTC).
 *
 * It holds every public and unlisted photo (projected as the API shows
 * it, with its bucket key), the cameras photos show and the camera
 * pictures /img serves by path; never a private, trashed or unfinished
 * photo. From it come the same answers D1 would give for /api/media,
 * /api/media/<id>, /api/camera, /api/camera/<slug> and the photo /
 * pathAccess RPCs (last-good.spec.ts checks they match). It is built by
 * buildSnapshot (query.ts), kept by last-good-store.ts and served by
 * last-good.ts.
 */
import type { PathAccess } from "./query";
import type { Route } from "./route";
import type { CameraJSON, MediaItemJSON } from "./types";

/** Bumped when the shape changes; an older snapshot is ignored. */
export const SNAPSHOT_FORMAT = 1;

export type Snapshot = {
  format: typeof SNAPSHOT_FORMAT;
  /** Public and unlisted photos, in the list's order. */
  photos: { item: MediaItemJSON; key: string; listed: boolean }[];
  /** Cameras a viewable photo shows (`listed`: a public one), by slug. */
  cameras: { camera: CameraJSON; listed: boolean }[];
  /** Camera pictures that /img serves by their bucket path. */
  cameraImages: string[];
};

/** An answer of the HTTP API. */
export type Answer = { status: 200 | 404; body: unknown };

const NOT_FOUND: Answer = { status: 404, body: { error: "not found" } };

/** Lookups over a snapshot. */
export type SnapshotIndex = {
  answer(route: Route): Answer;
  /** As the `photo` RPC. */
  photo(publicId: string): MediaItemJSON | null;
  /** As the `pathAccess` RPC. */
  pathAccess(path: string): PathAccess | null;
};

export const indexSnapshot = (s: Snapshot): SnapshotIndex => {
  const byId = new Map(s.photos.map((p) => [p.item.id, p]));
  const byPath = new Map(
    s.photos
      .filter((p) => p.listed && p.item.path !== null)
      .map((p) => [p.item.path as string, p]),
  );
  const cameras = new Map(s.cameras.map((c) => [c.camera.slug, c.camera]));
  const cameraImages = new Set(s.cameraImages);
  return {
    answer: (route) => {
      switch (route.kind) {
        case "media-list":
          return {
            status: 200,
            body: s.photos.filter((p) => p.listed).map((p) => p.item),
          };
        case "media": {
          const p = byId.get(route.id);
          return p ? { status: 200, body: p.item } : NOT_FOUND;
        }
        case "camera-list":
          return {
            status: 200,
            body: s.cameras.filter((c) => c.listed).map((c) => c.camera),
          };
        case "camera": {
          const c = cameras.get(route.slug);
          return c ? { status: 200, body: c } : NOT_FOUND;
        }
      }
    },
    photo: (publicId) => {
      const p = byId.get(publicId);
      return p ? { ...p.item, file: p.key } : null;
    },
    pathAccess: (path) => {
      const p = byPath.get(path);
      if (p) return { kind: "photo", photo: { ...p.item, file: p.key } };
      return cameraImages.has(path)
        ? { kind: "camera-image", file: path }
        : null;
    },
  };
};

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A hash of a stored snapshot (its JSON), to tell whether it changed. The
 * content version it was built at is kept beside it (KV metadata), not
 * in it, so the same content always has the same hash.
 */
export const snapshotHash = async (json: string): Promise<string> =>
  hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)),
  ).slice(0, 32);

/** A stored snapshot, or null if it is not one of this format. */
export const parseSnapshot = (raw: string): Snapshot | null => {
  try {
    const s = JSON.parse(raw) as Snapshot;
    return s && s.format === SNAPSHOT_FORMAT ? s : null;
  } catch {
    return null;
  }
};
