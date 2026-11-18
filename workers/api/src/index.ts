/**
 * Public API Worker: photo and camera metadata for the gallery, read from
 * the admin's D1 database (gallery-admin). Read-only; served at
 * gallery.sksat.net/api/* (route managed by Terraform outside this repo).
 *
 * Only public and unlisted data is ever returned (see query.ts), so the
 * Worker needs no authentication. Responses are cached at the edge for a
 * minute (Cache API) to keep D1 reads low, and kept for a week as
 * last-good copies served when D1 fails (see last-good.ts).
 *
 * Other Workers reach it through a service binding and call the RPC
 * methods below; those are not reachable over HTTP.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  getCamera,
  getPathAccess,
  getMedia,
  getPhotoForImage,
  listCameras,
  listPublicMedia,
  type PathAccess,
} from "./query";
import type { MediaItemJSON } from "./types";
import { jsonResponse, type Route } from "./route";
import { handleGet, withLastGood, type Context } from "./last-good";

export interface Env {
  DB: D1Database;
}

const NOT_FOUND = { error: "not found" };

const respond = async (db: D1Database, route: Route): Promise<Response> => {
  switch (route.kind) {
    case "media-list":
      return jsonResponse(200, await listPublicMedia(db));
    case "media": {
      const item = await getMedia(db, route.id);
      return item ? jsonResponse(200, item) : jsonResponse(404, NOT_FOUND);
    }
    case "camera-list":
      return jsonResponse(200, await listCameras(db));
    case "camera": {
      const camera = await getCamera(db, route.slug);
      return camera ? jsonResponse(200, camera) : jsonResponse(404, NOT_FOUND);
    }
  }
};

// A plain function, not a method: every method of the entrypoint is
// callable over RPC.
const lastGood = (ctx: ExecutionContext): Context => ({
  cache: caches.default,
  waitUntil: (p) => ctx.waitUntil(p),
});

export default class extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    return handleGet(
      request,
      (route) => respond(this.env.DB, route),
      lastGood(this.ctx),
    );
  }

  /**
   * What the image Worker may serve at /img/<path>: a public photo by its
   * display path (file name level "path"), with its bucket key, or a
   * camera picture (see getPathAccess).
   */
  async pathAccess(path: string): Promise<PathAccess | null> {
    return withLastGood(
      `/rpc/pathAccess/${encodeURIComponent(path)}`,
      () => getPathAccess(this.env.DB, path),
      lastGood(this.ctx),
    );
  }

  /**
   * A public or unlisted photo by public id, bucket path included even when
   * the file name is not public (the HTTP API leaves it out then): what the
   * image Worker needs to fetch the original. Null if there is none.
   */
  async photo(publicId: string): Promise<MediaItemJSON | null> {
    return withLastGood(
      `/rpc/photo/${encodeURIComponent(publicId)}`,
      () => getPhotoForImage(this.env.DB, publicId),
      lastGood(this.ctx),
    );
  }
}
