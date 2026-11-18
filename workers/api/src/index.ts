/**
 * Public API Worker: photo and camera metadata for the gallery, read from
 * the admin's D1 database (gallery-admin). Read-only; served at
 * gallery.sksat.net/api/* (route managed by Terraform outside this repo).
 *
 * Only public and unlisted data is ever returned (see query.ts), so the
 * Worker needs no authentication. Responses are cached at the edge for a
 * minute (Cache API) to keep D1 reads low.
 *
 * Other Workers reach it through a service binding and call the RPC
 * methods below; those are not reachable over HTTP.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  getCamera,
  getLegacyId,
  getFileAccess,
  getMedia,
  getPhotoForImage,
  listCameras,
  listPublicMedia,
  type FileAccess,
} from "./query";
import type { MediaItemJSON } from "./types";
import { jsonResponse, parseRoute, type Route } from "./route";

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
    case "legacy": {
      const id = await getLegacyId(db, route.index);
      return id ? jsonResponse(200, { id }) : jsonResponse(404, NOT_FOUND);
    }
    case "camera-list":
      return jsonResponse(200, await listCameras(db));
    case "camera": {
      const camera = await getCamera(db, route.slug);
      return camera ? jsonResponse(200, camera) : jsonResponse(404, NOT_FOUND);
    }
  }
};

export default class extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    const url = new URL(request.url);
    const route = parseRoute(url.pathname);
    if (!route) return jsonResponse(404, NOT_FOUND);

    // Cache by path only: the API takes no query parameters, so this also
    // keeps cache-busting query strings from reaching D1.
    const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return request.method === "HEAD" ? withoutBody(hit) : hit;

    let response: Response;
    try {
      response = await respond(this.env.DB, route);
    } catch (err) {
      console.error(`GET ${url.pathname} failed:`, err);
      return jsonResponse(500, { error: "internal server error" }, "no-store");
    }
    this.ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return request.method === "HEAD" ? withoutBody(response) : response;
  }

  /**
   * Whether the image Worker may serve a bucket path by file name (public
   * photos and camera pictures only; see getFileAccess).
   */
  async fileAccess(file: string): Promise<FileAccess | null> {
    return getFileAccess(this.env.DB, file);
  }

  /**
   * A public or unlisted photo by public id, bucket path included even when
   * the file name is not public (the HTTP API leaves it out then): what the
   * image Worker needs to fetch the original. Null if there is none.
   */
  async photo(publicId: string): Promise<MediaItemJSON | null> {
    return getPhotoForImage(this.env.DB, publicId);
  }
}

const withoutBody = (res: Response): Response =>
  new Response(null, { status: res.status, headers: res.headers });
