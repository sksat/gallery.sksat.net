// GET / HEAD /play/<id>/: a video's playback copy for the edit page's
// <video>, any visibility, streamed from R2 (MEDIA_CACHE binding) with Range
// support so the player can seek. Never the B2 original; `private`, not
// for shared caches.
//
// Answered before Qwik City (src/entry.cloudflare-pages.tsx) like the
// copy's PUTs (play-upload.ts): Qwik City's `send` pipes a response body
// through a JS stream, so every chunk of a long video would cost CPU time
// the Free plan does not have. The Access check runs here for the same
// reason.

import { serveVideo } from "@shared/video/range";
import { checkAccess } from "./access";
import { r2Key } from "./video";

export const PLAY_GET_RE = /^\/play\/(\d+)\/?$/;

export const handlePlayGet = async (
  request: Request,
  env: Record<string, unknown>,
  { access = checkAccess }: { access?: typeof checkAccess } = {},
): Promise<Response> => {
  const url = new URL(request.url);
  const m = PLAY_GET_RE.exec(url.pathname);
  const notFound = () =>
    new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  if (!m || (request.method !== "GET" && request.method !== "HEAD")) {
    return notFound();
  }
  const auth = await access({
    url,
    headers: request.headers,
    env,
    dev: false,
  });
  if (!auth.ok) {
    console.error(`[access] ${auth.status} ${request.url}: ${auth.reason}`);
    return new Response(
      auth.status === 403 ? "Forbidden" : "Service unavailable",
      { status: auth.status },
    );
  }
  const bucket = env.MEDIA_CACHE as R2Bucket | undefined;
  const db = env.DB as D1Database | undefined;
  if (!bucket || !db) return notFound();
  // The newest ready playback copy (a media_file row, 0017), one index
  // step on idx_media_file_media.
  const row = await db
    .prepare(
      `SELECT object_key AS key FROM media_file
       WHERE media_id = ? AND role = 'play' AND storage = 'r2'
         AND status = 'ready'
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(Number(m[1]))
    .first<{ key: string }>();
  if (!row) return notFound();
  return serveVideo(bucket, r2Key(row.key), request, "private, max-age=3600");
};
