/**
 * Public API Worker: photo and camera metadata for the gallery, read from
 * the admin's D1 database (gallery-admin). Read-only; served at
 * gallery.sksat.net/api/* (route managed by Terraform outside this repo).
 *
 * Only public and unlisted data is ever returned (see query.ts), so the
 * Worker needs no authentication. Responses are cached at the edge for a
 * minute (Cache API) to keep D1 reads low, and kept as a last-good
 * snapshot served when D1 fails (see last-good.ts; in the LAST_GOOD KV
 * namespace when it is bound, see last-good-store.ts).
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
import {
  cacheSnapshotStore,
  kvSnapshotStore,
  lastGood as makeLastGood,
} from "./last-good-store";

export interface Env {
  DB: D1Database;
  /**
   * The last-good snapshot (last-good-store.ts). Optional: without it the
   * snapshot stays in the Cache API.
   */
  LAST_GOOD?: KVNamespace;
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
const lastGood = (env: Env, ctx: ExecutionContext): Context => {
  const cache = caches.default;
  const lastGood = makeLastGood(
    env.LAST_GOOD ? kvSnapshotStore(env.LAST_GOOD) : cacheSnapshotStore(cache),
  );
  return {
    cache,
    lastGood,
    // With KV only the cron trigger writes (scheduled below).
    refresh: env.LAST_GOOD
      ? async () => {}
      : () => lastGood.refresh(env.DB, { throttle: true }),
    waitUntil: (p) => ctx.waitUntil(p),
  };
};

export default class extends WorkerEntrypoint<Env> {
  /**
   * The cron trigger (wrangler.jsonc, every minute): the one writer of
   * the KV snapshot (last-good-store.ts).
   */
  async scheduled(): Promise<void> {
    if (!this.env.LAST_GOOD) return;
    await makeLastGood(kvSnapshotStore(this.env.LAST_GOOD)).refresh(
      this.env.DB,
    );
  }

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
      lastGood(this.env, this.ctx),
    );
  }

  /**
   * What the image Worker may serve at /img/<path>: a public photo by its
   * display path (file name level "path"), with its bucket key, or a
   * camera picture (see getPathAccess).
   */
  async pathAccess(path: string): Promise<PathAccess | null> {
    return withLastGood(
      "pathAccess",
      () => getPathAccess(this.env.DB, path),
      (index) => index.pathAccess(path),
      lastGood(this.env, this.ctx),
    );
  }

  /**
   * A public or unlisted photo by public id, bucket path included even when
   * the file name is not public (the HTTP API leaves it out then): what the
   * image Worker needs to fetch the original. Null if there is none.
   */
  async photo(publicId: string): Promise<MediaItemJSON | null> {
    return withLastGood(
      "photo",
      () => getPhotoForImage(this.env.DB, publicId),
      (index) => index.photo(publicId),
      lastGood(this.env, this.ctx),
    );
  }
}
