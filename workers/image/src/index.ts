/**
 * Image Worker: serves resized gallery photos at /img/<preset>/<public_id>
 * (and camera pictures and public photos at /img/<preset>/<file>).
 *
 * The originals in B2 are up to 7680x4320 PNGs (~37MB). Decoding them needs
 * far more than a Worker's 128MB / 10ms (Free plan), so the resize itself is
 * done by Cloudflare Image Transformations through `fetch(..., { cf: { image } })`;
 * this Worker only maps a fixed set of presets to transformation options.
 * The `og` card's caption text is drawn by Image Transformations too.
 *
 * Two entry points, kept apart on purpose:
 *
 * - The default `fetch` handler (the public route) serves public data only.
 *   A public id resolves through the API Worker (`API` binding) while the
 *   photo is public or unlisted; a bucket path is served only for a public
 *   photo or a camera picture. It has no trusted-caller branch.
 * - `AdminImage` (a named RPC entrypoint, reachable only through a service
 *   binding that names it: the admin's) serves any photo, private included,
 *   and only after verifying the admin request's Cloudflare Access JWT.
 *
 * The originals are never served as-is.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { parseAccessConfig, verifyAdminToken } from "./admin-auth";
import { captionFor, type Caption, type CaptionSource } from "./caption";
import {
  isCardPreset,
  parseAdminImage,
  parseImagePath,
  transformFailed,
  transformOptions,
  variesByAccept,
  type PresetName,
  type TransformOptions,
} from "./request";

/** What the API returns for a photo (workers/api/src/types.ts). */
type Photo = CaptionSource & { id: string; file: string };

/** The API's getFileAccess (workers/api/src/query.ts). */
type FileAccess = { kind: "photo"; photo: Photo } | { kind: "camera-image" };

/** The API Worker, through a service binding. */
interface Api {
  fetch(request: Request): Promise<Response>;
  /** Whether a bucket path may be served by file name (RPC). */
  fileAccess(file: string): Promise<FileAccess | null>;
}

interface Env {
  /** Base URL of the originals, without a trailing slash. */
  ORIGIN_BASE_URL: string;
  API: Api;
  /** Cloudflare Access team domain and the admin's AUD tags (AdminImage). */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A public or unlisted photo by public id; null if there is none (private
 * or unknown). Goes through the API's HTTP handler rather than RPC so its
 * edge cache saves a D1 read per image request. Throws if the API fails.
 */
const photoById = async (env: Env, id: string): Promise<Photo | null> => {
  // The host is a placeholder: a service binding ignores it.
  const res = await env.API.fetch(
    new Request(`https://gallery-api/api/media/${id}`),
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API returned ${res.status} for ${id}`);
  const photo = (await res.json()) as Photo;
  if (typeof photo?.file !== "string" || !photo.file.startsWith("/")) {
    throw new Error(`API returned no file for ${id}`);
  }
  return photo;
};

const transform = (url: string, image: TransformOptions) =>
  fetch(url, {
    // workers-types does not know `draw` text entries yet (documented at
    // https://developers.cloudflare.com/images/optimization/draw-overlays/).
    cf: { image: image as RequestInitCfPropertiesImage },
  });

/**
 * Resize `file` with `preset`. `degraded` is set when a card had to be
 * drawn without its caption. The caller sets Cache-Control.
 */
const render = async (
  env: Env,
  file: string,
  preset: PresetName,
  accept: string | null,
  origin: string,
  caption: Caption = {},
): Promise<{ upstream: Response; degraded: boolean }> => {
  const original = env.ORIGIN_BASE_URL + file;
  let upstream = await transform(
    original,
    transformOptions(preset, accept, origin, caption),
  );
  let degraded = false;
  if (
    transformFailed(upstream.status, upstream.headers.get("Cf-Resized")) &&
    (caption.primary || caption.secondary)
  ) {
    // If the text overlay is rejected (font fetch, limits), a card with
    // just the badge is still better than a broken og:image.
    upstream = await transform(
      original,
      transformOptions(preset, accept, origin),
    );
    degraded = true;
  }
  return { upstream, degraded };
};

const respond = (
  upstream: Response,
  preset: PresetName,
  cacheControl: string,
): Response => {
  const headers = new Headers(upstream.headers);
  if (variesByAccept(preset)) headers.set("Vary", "Accept");
  headers.set("Cache-Control", upstream.ok ? cacheControl : "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
};

/** The public route: public (and, by id, unlisted) photos only. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const parsed = parseImagePath(url.pathname);
    if (!parsed) return plain(404, "Not Found");

    let file: string;
    let caption: Caption = {};
    const notFound = () =>
      new Response("Not Found", {
        status: 404,
        // Cached for a minute, like the API's own answer.
        headers: { "Cache-Control": "public, max-age=60" },
      });

    if ("id" in parsed) {
      let photo: Photo | null;
      try {
        photo = await photoById(env, parsed.id);
      } catch (err) {
        console.error(`photo lookup for ${parsed.id} failed:`, err);
        return plain(503, "Service Unavailable");
      }
      if (!photo) return notFound();
      file = photo.file;
      if (parsed.preset === "og") caption = captionFor(photo);
    } else {
      // By bucket path, only a public photo or a camera picture: unlisted
      // and private photos have guessable file names, so they are reachable
      // by public id only.
      file = parsed.file;
      let access: FileAccess | null;
      try {
        access = await env.API.fileAccess(file);
      } catch (err) {
        console.error(`file lookup for ${file} failed:`, err);
        return plain(503, "Service Unavailable");
      }
      if (!access) return notFound();
      if (isCardPreset(parsed.preset)) {
        // Cards only for photos: keeps the transformation count bounded.
        if (access.kind !== "photo") return notFound();
        if (parsed.preset === "og") caption = captionFor(access.photo);
      }
    }

    const { upstream, degraded } = await render(
      env,
      file,
      parsed.preset,
      request.headers.get("Accept"),
      url.origin,
      caption,
    );
    return respond(
      upstream,
      parsed.preset,
      degraded
        ? "public, max-age=300"
        : // A photo made private stops resolving at once, but browsers may
          // keep a copy for up to an hour.
          "public, max-age=3600",
    );
  },
} satisfies ExportedHandler<Env>;

/**
 * The admin's thumbnails, private photos included. Reachable only through a
 * service binding that names this entrypoint, and even then only with the
 * admin request's Cloudflare Access JWT, which is verified here (fail
 * closed). Resize presets only; responses must not be shared by caches.
 */
export class AdminImage extends WorkerEntrypoint<Env> {
  async image(
    accessJwt: string | null,
    file: string,
    preset: string,
    accept: string | null,
  ): Promise<Response> {
    const auth = await verifyAdminToken(accessJwt, parseAccessConfig(this.env));
    if (!auth.ok) {
      console.error(`AdminImage: ${auth.status} ${auth.reason}`);
      return plain(auth.status, auth.status === 403 ? "Forbidden" : "Error");
    }
    const parsed = parseAdminImage(preset, file);
    if (!parsed) return plain(404, "Not Found");
    // Resize presets draw no card assets, so no origin is needed.
    const { upstream } = await render(
      this.env,
      parsed.file,
      parsed.preset,
      accept,
      "",
    );
    return respond(upstream, parsed.preset, "private, max-age=3600");
  }
}
