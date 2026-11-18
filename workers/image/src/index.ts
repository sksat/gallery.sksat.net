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
 *   and only after verifying the admin request's Cloudflare Access JWT. Its
 *   `stat` reports an object's size and hash metadata (upload checks), and
 *   `bytes` returns an original's first or last bytes (metadata backfill).
 *
 * The originals are never served as-is. With B2 credentials the Worker
 * fetches them through presigned URLs (origin.ts), so the bucket can be
 * private.
 *
 * The public handler keeps its finished images in the edge cache
 * (cache.ts) once access is checked; `AdminImage` never touches it.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { parseAccessConfig, verifyAdminToken } from "./admin-auth";
import { parseRange, readObjectBytes, type ObjectBytes } from "./bytes";
import { edgeCacheKey, withEdgeCache } from "./cache";
import { captionFor, type Caption, type CaptionSource } from "./caption";
import { embedExif } from "./exif-embed";
import { encodeTiff } from "./exif-encode";
import { publicExif, type PublicMeta } from "./public-exif";
import { originFor, type OriginEnv } from "./origin";
import { statObject, type ObjectStat } from "./stat";
import {
  isCardPreset,
  parseAdminImage,
  parseImagePath,
  transformFailed,
  transformOptions,
  variesByAccept,
  withoutAvif,
  type PresetName,
  type TransformOptions,
} from "./request";

/**
 * What the API returns for a photo (workers/api/src/types.ts). `file` is
 * null over HTTP when the file name is not public; the `photo` RPC always
 * has it.
 */
type Photo = CaptionSource & PublicMeta & { id: string; file: string | null };

/** The API's getFileAccess (workers/api/src/query.ts). */
type FileAccess = { kind: "photo"; photo: Photo } | { kind: "camera-image" };

/** The API Worker, through a service binding. */
interface Api {
  fetch(request: Request): Promise<Response>;
  /** Whether a bucket path may be served by file name (RPC). */
  fileAccess(file: string): Promise<FileAccess | null>;
  /** A public or unlisted photo by public id, with its bucket path (RPC). */
  photo(publicId: string): Promise<Photo | null>;
}

interface Env extends OriginEnv {
  API: Api;
  /** Cloudflare Access team domain and the admin's AUD tags (AdminImage). */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/** The photo over the API's HTTP handler (no file when its name is hidden). */
const photoOverHttp = async (env: Env, id: string): Promise<Photo | null> => {
  // The host is a placeholder: a service binding ignores it.
  const res = await env.API.fetch(
    new Request(`https://gallery-api/api/media/${id}`),
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API returned ${res.status} for ${id}`);
  return (await res.json()) as Photo;
};

/**
 * A public or unlisted photo by public id; null if there is none (private
 * or unknown). Throws if the API fails.
 *
 * This runs on every request, before the edge cache (its key needs the
 * file, and a photo made private must stop at once), so it goes through
 * the API's HTTP handler first: that answer is cached for 60 s (Cache
 * API), which keeps D1 reads down. Only when the HTTP answer leaves the
 * file out (its name is not public) does it ask the `photo` RPC, which
 * reads D1 each time but includes the bucket path. An API Worker from
 * before that RPC always returns the file, so it never gets there.
 */
const photoById = async (
  env: Env,
  id: string,
): Promise<(Photo & { file: string }) | null> => {
  let photo = await photoOverHttp(env, id);
  if (photo && photo.file === null) photo = await env.API.photo(id);
  if (!photo) return null;
  // The file goes into the origin URL: hold it to the same shape as a
  // requested bucket path.
  const asPath =
    typeof photo?.file === "string"
      ? parseImagePath(`/img/h240${photo.file}`)
      : null;
  if (!asPath || !("file" in asPath)) {
    throw new Error(`API returned no usable file for ${id}`);
  }
  return { ...photo, file: asPath.file };
};

const transform = (originUrl: string, image: TransformOptions) =>
  fetch(originUrl, {
    cf: {
      // workers-types does not know `draw` text entries yet (documented at
      // https://developers.cloudflare.com/images/optimization/draw-overlays/).
      image: image as RequestInitCfPropertiesImage,
      // No `cacheKey`: it is Enterprise-only and ignored here, so the
      // resized image is cached under `originUrl`, which originFor keeps
      // stable.
    },
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
  const original = await originFor(env, file);
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
  if (!upstream.ok) {
    // Don't pass the origin's error body (e.g. B2's XML) through.
    console.error(`transform failed: ${upstream.status}`);
    return plain(upstream.status === 404 ? 404 : 502, "Image unavailable");
  }
  const headers = new Headers(upstream.headers);
  if (variesByAccept(preset)) headers.set("Vary", "Accept");
  headers.set("Cache-Control", cacheControl);
  return new Response(upstream.body, { status: upstream.status, headers });
};

/**
 * A transformed image with `tiff` as its EXIF (exif-embed.ts). Only a
 * finished 200 is touched; anything else, or a format the edit does not
 * support, passes through as it was.
 */
const withExif = async (
  upstream: Response,
  tiff: Uint8Array,
): Promise<Response> => {
  if (
    upstream.status !== 200 ||
    transformFailed(upstream.status, upstream.headers.get("Cf-Resized"))
  ) {
    return upstream;
  }
  const image = new Uint8Array(await upstream.arrayBuffer());
  const { bytes, embedded } = embedExif(
    image,
    upstream.headers.get("Content-Type"),
    tiff,
  );
  const headers = new Headers(upstream.headers);
  if (embedded) {
    headers.delete("Content-Length");
    // The upstream validators describe the image without this EXIF: a
    // revalidation must not confirm a copy carrying older metadata.
    const base = (upstream.headers.get("ETag") ?? String(image.length))
      .replace(/^W\//, "")
      .replace(/"/g, "");
    headers.set("ETag", `W/"${base}-${await exifKey(tiff)}"`);
    headers.delete("Last-Modified");
  }
  return new Response(bytes, { status: upstream.status, headers });
};

/** A short digest of the EXIF block, for the edge cache key and ETag. */
const exifKey = async (tiff: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", tiff));
  return Array.from(digest.subarray(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

/** The public route: public (and, by id, unlisted) photos only. */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
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
    /** The photo's public metadata, to embed as EXIF (not in cards). */
    let meta: PublicMeta | null = null;
    const notFound = () =>
      new Response("Not Found", {
        status: 404,
        // Cached for a minute, like the API's own answer.
        headers: { "Cache-Control": "public, max-age=60" },
      });

    if ("id" in parsed) {
      let photo: Awaited<ReturnType<typeof photoById>>;
      try {
        photo = await photoById(env, parsed.id);
      } catch (err) {
        console.error(`photo lookup for ${parsed.id} failed:`, err);
        return plain(503, "Service Unavailable");
      }
      if (!photo) return notFound();
      file = photo.file;
      if (parsed.preset === "og") caption = captionFor(photo);
      meta = photo;
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
      if (access.kind === "photo") meta = access.photo;
    }

    // The public metadata as EXIF, for resized photos (cards carry none).
    // It cannot go into AVIF here, so a photo with any gets WebP or JPEG.
    const tiff =
      meta && !isCardPreset(parsed.preset)
        ? encodeTiff(publicExif(meta))
        : null;
    const accept = tiff
      ? withoutAvif(request.headers.get("Accept"))
      : request.headers.get("Accept");
    const produce = async () => {
      const rendered = await render(
        env,
        file,
        parsed.preset,
        accept,
        url.origin,
        caption,
      );
      const { degraded } = rendered;
      // HEAD has no body to put it in.
      const upstream =
        tiff && request.method === "GET"
          ? await withExif(rendered.upstream, tiff)
          : rendered.upstream;
      const response = respond(
        upstream,
        parsed.preset,
        degraded
          ? "public, max-age=300"
          : // A photo made private stops resolving at once (the edge cache
            // is consulted only after the check above), but browsers may
            // keep a copy for up to an hour.
            "public, max-age=3600",
      );
      // A card without its caption is retried on the next request instead.
      return { response, store: !degraded };
    };
    // HEAD is rare (link checkers); it skips the cache.
    if (request.method !== "GET") return (await produce()).response;
    return withEdgeCache(
      caches.default,
      edgeCacheKey(
        url.origin,
        parsed.preset,
        file,
        accept,
        caption,
        tiff ? await exifKey(tiff) : null,
      ),
      variesByAccept(parsed.preset) ? "Accept" : null,
      (promise) => ctx.waitUntil(promise),
      produce,
    );
  },
} satisfies ExportedHandler<Env>;

/**
 * The admin's thumbnails, private photos included. Reachable only through a
 * service binding that names this entrypoint, and even then only with the
 * admin request's Cloudflare Access JWT, which is verified here (fail
 * closed). Resize presets only; responses must not be shared by caches, so
 * this path never uses the edge cache (cache.ts), only `private` browser
 * caching.
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

  /**
   * What the bucket has at `file` (size, etag, SHA-256 metadata), or null:
   * the admin checks an upload with it before marking the photo ready, as
   * its own key cannot read the bucket (stat.ts). Same Access check and
   * path rules as `image`.
   */
  async stat(
    accessJwt: string | null,
    file: string,
  ): Promise<
    { ok: true; stat: ObjectStat | null } | { ok: false; status: number }
  > {
    const auth = await verifyAdminToken(accessJwt, parseAccessConfig(this.env));
    if (!auth.ok) {
      console.error(`AdminImage.stat: ${auth.status} ${auth.reason}`);
      return { ok: false, status: auth.status };
    }
    // Any resize preset: only the path rules matter here.
    if (!parseAdminImage("h240", file)) return { ok: false, status: 404 };
    try {
      const stat = await statObject(this.env, file);
      console.log(`AdminImage.stat ${file}: ${stat ? stat.size : "none"}`);
      return { ok: true, stat };
    } catch (err) {
      // A plain error result (502) instead of an exception across the RPC.
      console.error(`AdminImage.stat ${file} failed:`, err);
      return { ok: false, status: 502 };
    }
  }

  /**
   * Some bytes of the original at `file` (at most MAX_RANGE_BYTES: its
   * start, or its last bytes), with its size; `bytes` null when there is
   * no such object. For the admin's metadata backfill, which reads the
   * EXIF/XMP of photos uploaded before it existed (bytes.ts). Same Access
   * check and path rules as `stat`.
   */
  async bytes(
    accessJwt: string | null,
    file: string,
    range: unknown,
  ): Promise<
    { ok: true; object: ObjectBytes | null } | { ok: false; status: number }
  > {
    const auth = await verifyAdminToken(accessJwt, parseAccessConfig(this.env));
    if (!auth.ok) {
      console.error(`AdminImage.bytes: ${auth.status} ${auth.reason}`);
      return { ok: false, status: auth.status };
    }
    // A path outside the rules is never served (404, as in `stat`); a bad
    // range is the caller's mistake (400).
    if (!parseAdminImage("h240", file)) return { ok: false, status: 404 };
    const parsed = parseRange(range);
    if (!parsed) return { ok: false, status: 400 };
    try {
      return {
        ok: true,
        object: await readObjectBytes(this.env, file, parsed),
      };
    } catch (err) {
      console.error(`AdminImage.bytes ${file} failed:`, err);
      return { ok: false, status: 502 };
    }
  }
}
