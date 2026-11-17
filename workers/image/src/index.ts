/**
 * Image Worker: serves resized gallery photos at /img/<preset>/<file>.
 *
 * The originals in B2 are up to 7680x4320 PNGs (~37MB). Decoding them needs
 * far more than a Worker's 128MB / 10ms (Free plan), so the resize itself is
 * done by Cloudflare Image Transformations through `fetch(..., { cf: { image } })`;
 * this Worker only maps a fixed set of presets to transformation options.
 * The `og` card's caption text is drawn by Image Transformations too.
 */
import { captionFor, findCaptionSource, type Caption } from "./caption";
import {
  parseImagePath,
  transformFailed,
  transformOptions,
  variesByAccept,
  type TransformOptions,
} from "./request";

interface Env {
  /** Base URL of the originals, without a trailing slash. */
  ORIGIN_BASE_URL: string;
}

type Lookup = { found: true; caption: Caption } | { found: false } | null;

/**
 * Caption for `file` from media.json (cached at the edge for 5 minutes).
 * `{ found: false }` if the file is not listed; null if media.json could not
 * be read, in which case the card is drawn without a caption.
 */
const lookupCaption = async (env: Env, file: string): Promise<Lookup> => {
  try {
    const res = await fetch(env.ORIGIN_BASE_URL + "/media.json", {
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    const source = findCaptionSource(await res.json(), file);
    return source
      ? { found: true, caption: captionFor(source) }
      : { found: false };
  } catch {
    return null;
  }
};

const transform = (url: string, image: TransformOptions) =>
  fetch(url, {
    // workers-types does not know `draw` text entries yet (documented at
    // https://developers.cloudflare.com/images/optimization/draw-overlays/).
    cf: { image: image as RequestInitCfPropertiesImage },
  });

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
    if (!parsed) return new Response("Not Found", { status: 404 });

    const accept = request.headers.get("Accept");
    const original = env.ORIGIN_BASE_URL + parsed.file;

    let caption: Caption = {};
    // A card without its caption is cached briefly so the full one replaces it.
    let degraded = false;
    if (parsed.preset === "og") {
      const lookup = await lookupCaption(env, parsed.file);
      // Cards only for listed photos: keeps the transformation count bounded.
      // (A new photo may 404 here until the 5-minute media.json cache expires.)
      if (lookup && !lookup.found) {
        return new Response("Not Found", {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
      if (lookup) caption = lookup.caption;
      else degraded = true;
    }

    let upstream = await transform(
      original,
      transformOptions(parsed.preset, accept, url.origin, caption),
    );
    if (
      transformFailed(upstream.status, upstream.headers.get("Cf-Resized")) &&
      (caption.primary || caption.secondary)
    ) {
      // If the text overlay is rejected (font fetch, limits), a card with
      // just the badge is still better than a broken og:image.
      upstream = await transform(
        original,
        transformOptions(parsed.preset, accept, url.origin),
      );
      degraded = true;
    }

    const headers = new Headers(upstream.headers);
    if (variesByAccept(parsed.preset)) headers.set("Vary", "Accept");
    // The photos are public. Lets the admin panel (another origin) fetch()
    // a preview to show its download progress.
    headers.set("Access-Control-Allow-Origin", "*");
    if (upstream.ok) {
      headers.set(
        "Cache-Control",
        degraded
          ? "public, max-age=300"
          : "public, max-age=86400, stale-while-revalidate=604800",
      );
    } else {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
} satisfies ExportedHandler<Env>;
