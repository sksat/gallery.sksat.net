/**
 * Image Worker: serves resized gallery photos at /img/<preset>/<file>.
 *
 * The originals in B2 are up to 7680x4320 PNGs (~37MB). Decoding them needs
 * far more than a Worker's 128MB / 10ms (Free plan), so the resize itself is
 * done by Cloudflare Image Transformations through `fetch(..., { cf: { image } })`;
 * this Worker only maps a fixed set of presets to transformation options.
 */
import { parseImagePath, transformOptions, variesByAccept } from "./request";

interface Env {
  /** Base URL of the originals, without a trailing slash. */
  ORIGIN_BASE_URL: string;
}

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

    const upstream = await fetch(env.ORIGIN_BASE_URL + parsed.file, {
      cf: {
        image: transformOptions(
          parsed.preset,
          request.headers.get("Accept"),
          url.origin,
        ),
      },
    });

    const headers = new Headers(upstream.headers);
    if (variesByAccept(parsed.preset)) headers.set("Vary", "Accept");
    if (upstream.ok) {
      headers.set(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=604800",
      );
    } else {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
} satisfies ExportedHandler<Env>;
