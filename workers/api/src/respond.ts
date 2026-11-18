/** The HTTP API's answers, read from D1 (kept by last-good.ts). */
import { getCamera, getMedia, listCameras, listPublicMedia } from "./query";
import type { Entry } from "./last-good";
import type { Route } from "./route";

const NOT_FOUND = JSON.stringify({ error: "not found" });

const ok = (body: unknown): Entry => ({
  status: 200,
  body: JSON.stringify(body),
});

/** The answer for a route. Throws if D1 fails. */
export const respond = async (db: D1Database, route: Route): Promise<Entry> => {
  switch (route.kind) {
    case "media-list":
      return ok(await listPublicMedia(db));
    case "media": {
      const item = await getMedia(db, route.id);
      return item ? ok(item) : { status: 404, body: NOT_FOUND };
    }
    case "camera-list":
      return ok(await listCameras(db));
    case "camera": {
      const camera = await getCamera(db, route.slug);
      return camera ? ok(camera) : { status: 404, body: NOT_FOUND };
    }
  }
};
