/**
 * The admin's fallback when a resize fails (tested with Vitest): the
 * AdminImage entrypoint serves the source file itself for the large
 * presets, so the admin's full-screen preview and the edit page's photo
 * still show a photo when Image Transformations refuses new resizes (the
 * free tier's monthly unique transformations used up: 429 / error 9422).
 *
 * Admin only. The public handler never serves a source file: an original
 * carries its full EXIF/XMP (GPS, camera serials, VRChat world and author
 * ids), and what the public sees of those is decided by the API's metadata
 * levels. Nor does this response ever enter the edge cache (it is
 * `private`, and AdminImage never touches caches.default).
 *
 * The file is streamed through whatever its size (no decoding, so it costs
 * the Worker almost no CPU); the browser decodes it.
 */
import type { PresetName } from "./request";

/**
 * The presets the admin draws large (the full-screen preview and the edit
 * page's photo). Thumbnail presets (h240/h480) are left out: a grid of
 * originals would be hundreds of MB, so a failed thumbnail stays a failure
 * and the admin shows its placeholder tile.
 */
export const FALLBACK_PRESETS: ReadonlySet<PresetName> = new Set([
  "w1200",
  "w1920",
  "w2560",
  "w3840",
]);

/** Response header marking a fallback, so the admin can tell. */
export const FALLBACK_HEADER = "X-Image-Fallback";

/**
 * Whether a failed resize of `preset` (Image Transformations answered
 * `status`) is answered with the source file instead. Not for a missing
 * file (404: there is nothing to serve).
 */
export const fallsBackToSource = (
  preset: PresetName,
  status: number,
): boolean => FALLBACK_PRESETS.has(preset) && status !== 404;

const TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/**
 * The content type to serve `file` with: the one its extension names
 * (paths always end in .png/.jpg/.jpeg, request.ts parseFilePath). Never
 * the bucket's, which could be anything (e.g. image/svg+xml) for an
 * object not written by the admin's upload.
 */
export const sourceContentType = (file: string): string => {
  const ext = /\.([A-Za-z]+)$/.exec(file)?.[1].toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[ext] ?? "application/octet-stream";
};

/**
 * The fallback response for the bucket's answer `res` to a plain GET of
 * `file`, or null when it is not a 200 (the caller then discards the
 * body). Only the length (for the admin's progress bar) is taken from the
 * bucket's headers.
 */
export const sourceResponse = (
  res: Response,
  file: string,
): Response | null => {
  if (res.status !== 200) return null;
  const headers = new Headers({
    "Content-Type": sourceContentType(file),
    "X-Content-Type-Options": "nosniff",
    // Kept briefly: a real resize is better once transformations work
    // again.
    "Cache-Control": "private, max-age=300",
    [FALLBACK_HEADER]: "original",
  });
  const length = res.headers.get("Content-Length")?.trim() ?? "";
  // (A body fetch decoded no longer has the stored length.)
  if (/^\d+$/.test(length) && !res.headers.has("Content-Encoding")) {
    headers.set("Content-Length", length);
  }
  return new Response(res.body, { status: 200, headers });
};
