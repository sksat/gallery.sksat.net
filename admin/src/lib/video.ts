// Where a video's two copies go (media_file rows, 0013; videos 0017), and
// the playback bucket. Covered by video.spec.ts.
//
// - The poster (role 'poster', storage 'b2'): a JPEG at
//   /.poster/<random>.jpg, resized by the image Worker like a photo's
//   original. "/.poster" is a folder no upload or move can name (folder
//   names never start with "."), and a new poster gets a new key, so no
//   cache keeps serving an old frame.
// - The playback copy (role 'play', storage 'r2'): media_file.object_key
//   /v/<random>.<ext>, stored in the R2 bucket `gallery-media-cache` (binding
//   MEDIA_CACHE) under that key without its leading "/" (r2Key), i.e. under
//   `v/`; the bucket holds every served derived file, and resized photos
//   will go under `img/`. The copy is the original with its metadata
//   taken out (video-meta.ts). Written through the
//   admin's R2 binding, read by the image Worker's /video/<public_id> and
//   the admin's /play/<id>.

import { generatePublicId, type RandomBytes } from "./public-id";

const randomPart = (random?: RandomBytes) =>
  generatePublicId(random) + generatePublicId(random);

export const POSTER_PREFIX = "/.poster/";

export const newPosterKey = (random?: RandomBytes): string =>
  `${POSTER_PREFIX}${randomPart(random)}.jpg`;

const PLAY_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  // A QuickTime file is ISO BMFF too, served as video/mp4: what browsers
  // other than Safari play.
  "video/quicktime": "mp4",
  "video/webm": "webm",
};

/** The content type the copy is stored and served with. */
export const playContentType = (contentType: string): string =>
  contentType === "video/webm" ? "video/webm" : "video/mp4";

/** A new playback copy's media_file.object_key. */
export const newPlayKey = (contentType: string, random?: RandomBytes): string =>
  `/v/${randomPart(random)}.${PLAY_EXT[contentType] ?? "mp4"}`;

export const PLAY_KEY_RE =
  /^\/v\/[23456789abcdefghjkmnpqrstuvwxyz]{20}\.(mp4|webm)$/;
export const POSTER_KEY_RE =
  /^\/\.poster\/[23456789abcdefghjkmnpqrstuvwxyz]{20}\.jpg$/;

/** The R2 object key of a media_file.object_key ("/v/a.mp4" → "v/a.mp4"). */
export const r2Key = (objectKey: string): string =>
  objectKey.replace(/^\//, "");
