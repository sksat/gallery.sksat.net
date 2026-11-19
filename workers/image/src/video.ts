/**
 * Videos (admin migration 0017; tested in video.spec.ts and index.spec.ts).
 *
 * A video's images (/img/<id>, thumbnails, og cards) are resized from its
 * poster, a JPEG the admin's browser drew: the API's `source` for a video
 * is its poster, like a photo's display copy. A video without one has no
 * image (404). The video itself is served at /video/<public_id> from its
 * playback copy in R2 (binding MEDIA_CACHE; the API's `play`): the original
 * without its metadata (see the admin's video-meta.ts). The B2 original
 * is never served.
 */
import { PUBLIC_ID_RE } from "./request";

/** Where a file is (the API's FileSource). */
export type FileSource = { storage: "b2" | "r2"; key: string };

/**
 * A playback copy's media_file.object_key (admin video.ts): "/v/" and 20
 * id letters. Anything else from the API is not served.
 */
export const PLAY_KEY_RE =
  /^\/v\/[23456789abcdefghjkmnpqrstuvwxyz]{20}\.(mp4|webm)$/;

/** The R2 object of a video's `play`, or null when there is none to serve. */
export const playObjectKey = (
  play: FileSource | null | undefined,
): string | null =>
  play && play.storage === "r2" && PLAY_KEY_RE.test(play.key)
    ? play.key.slice(1)
    : null;

/**
 * `/video/<public_id>` (a trailing slash is not accepted): the id, null
 * for any other path (404), `{ status: 400 }` with a query (the URL is
 * the cache key of browsers; nothing may vary it).
 */
export const parseVideoUrl = (
  url: URL,
): { id: string } | { status: 400 } | null => {
  const m = /^\/video\/([^/]+)$/.exec(url.pathname);
  if (!m || !PUBLIC_ID_RE.test(m[1])) return null;
  if (url.search !== "") return { status: 400 };
  return { id: m[1] };
};

/**
 * Cache-Control of a video: an hour in browsers, like the images (a video
 * made private stops here within about a minute, the API's content
 * version memo; browsers may keep their copy for that long). A Worker's answer is not kept by the CDN; the Worker reads R2 for
 * every range the player asks for.
 */
export const VIDEO_CACHE_CONTROL = "public, max-age=3600";
