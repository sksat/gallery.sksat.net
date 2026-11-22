/**
 * Public API Worker: photo and camera metadata for the gallery, read from
 * the admin's D1 database (gallery-admin). Read-only; served at
 * gallery.sksat.net/api/* (route managed by Terraform outside this repo).
 *
 * Only public and unlisted data is ever returned (see query.ts), so the
 * Worker needs no authentication. Every answer is kept in the data
 * centre's Cache API per content version, so D1 is read only after the
 * admin changed something, and those answers are served while D1 fails
 * (see last-good.ts).
 *
 * Other Workers reach it through a service binding and call the RPC
 * methods below; those are not reachable over HTTP.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  getPathAccess,
  getPhotoForImage,
  type ImagePhoto,
  type PathAccess,
} from "./query";
import {
  claimCopiesJobs,
  copiesMaker,
  finishCopiesJob,
  type CopiesJob,
} from "./copies";
import { handleGet, rpcAnswer, type Context } from "./last-good";
import { respond } from "./respond";
import { parseWorldRoute, PUBLIC_ID_RE } from "./route";
import type { PreviewContext } from "./world";
import { handleWorldGet, photoWorldPreview, UNAVAILABLE } from "./world-route";

export interface Env {
  DB: D1Database;
  /** Where VRChat's world pages are; https://vrchat.com unless set (tests). */
  VRCHAT_ORIGIN?: string;
}

// Plain functions, not methods: every method of the entrypoint is
// callable over RPC.
const context = (env: Env, ctx: ExecutionContext): Context => ({
  cache: caches.default,
  db: env.DB,
  waitUntil: (p) => ctx.waitUntil(p),
});

const previewContext = (env: Env, ctx: ExecutionContext): PreviewContext => ({
  cache: caches.default,
  fetch: (input, init) => fetch(input, init),
  waitUntil: (p) => ctx.waitUntil(p),
  origin: env.VRCHAT_ORIGIN || "https://vrchat.com",
});

export default class extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    const worldOf = parseWorldRoute(new URL(request.url).pathname);
    if (worldOf) {
      return handleWorldGet(
        request,
        worldOf,
        context(this.env, this.ctx),
        previewContext(this.env, this.ctx),
      );
    }
    return handleGet(
      request,
      (route) => respond(this.env.DB, route),
      context(this.env, this.ctx),
    );
  }

  /**
   * What the image Worker may serve at /img/<path>: a public photo by its
   * display path (file name level "path"), with its bucket key, or a
   * camera picture (see getPathAccess).
   */
  async pathAccess(path: string): Promise<PathAccess | null> {
    return rpcAnswer(
      `rpc/path/${encodeURIComponent(path)}`,
      () => getPathAccess(this.env.DB, path),
      context(this.env, this.ctx),
    );
  }

  /**
   * A public or unlisted photo by public id, bucket path included even when
   * the file name is not public (the HTTP API leaves it out then), and
   * `source`, the file the image Worker resizes (the file the photo shows,
   * or its display copy). Null if there is none.
   */
  /**
   * Claim photos whose resized copies the image Worker makes next (its
   * cron, or `ids`: a photo just uploaded): copies.ts. Writes
   * media.resized_at only.
   */
  async claimCopies(limit: number, ids?: number[]): Promise<CopiesJob[]> {
    const valid =
      ids === undefined ||
      (Array.isArray(ids) && ids.every((n) => Number.isInteger(n) && n > 0));
    if (!valid || !Number.isInteger(limit)) return [];
    return claimCopiesJobs(this.env.DB, limit, ids);
  }

  /** End a claim of claimCopies (made, failed now, or for the browser). */
  async finishCopies(
    id: number,
    claim: string,
    outcome: "made" | "failed" | "browser",
  ): Promise<boolean> {
    if (
      !Number.isInteger(id) ||
      typeof claim !== "string" ||
      !["made", "failed", "browser"].includes(outcome)
    ) {
      return false;
    }
    return finishCopiesJob(this.env.DB, id, claim, outcome);
  }

  /** Which maker the site uses for the copies (`setting` resize_maker). */
  async copiesMaker(): Promise<"worker" | "browser"> {
    return copiesMaker(this.env.DB);
  }

  /**
   * The picture of a photo's VRChat world (an https URL on VRChat's file
   * server), for the image Worker's /img/world/<public_id>: only for a
   * public or unlisted photo whose world level shows the link. Null if
   * there is none. Throws when the photo cannot be read.
   */
  async worldImage(publicId: string): Promise<string | null> {
    if (typeof publicId !== "string" || !PUBLIC_ID_RE.test(publicId)) {
      return null;
    }
    const got = await photoWorldPreview(
      publicId,
      context(this.env, this.ctx),
      previewContext(this.env, this.ctx),
    );
    if (got === UNAVAILABLE) throw new Error("the photo cannot be read");
    return typeof got === "object" && got !== null ? got.image : null;
  }

  async photo(publicId: string): Promise<ImagePhoto | null> {
    return rpcAnswer(
      `rpc/photo/${encodeURIComponent(publicId)}`,
      () => getPhotoForImage(this.env.DB, publicId),
      context(this.env, this.ctx),
    );
  }
}
