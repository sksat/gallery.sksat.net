// The /thumb route's answer for an AdminImage response (src/routes/thumb).

/**
 * Set by the image Worker when a large preset could not be resized and the
 * photo's file itself is served instead (workers/image/src/fallback.ts).
 */
export const FALLBACK_HEADER = "X-Image-Fallback";

/**
 * Headers for the browser: always private. A resized image is kept for an
 * hour; the file served as a fallback only briefly, so a real resize
 * replaces it once transformations work again, and with its length, so
 * the preview's progress bar works for a download that may be tens of MB.
 * Nothing else of the Worker's headers is passed on. A video's poster,
 * which the edit page can replace under the same URL, is kept a minute.
 */
export const thumbHeaders = (
  upstream: Response,
  { poster = false }: { poster?: boolean } = {},
): Headers => {
  const fallback = upstream.ok && upstream.headers.has(FALLBACK_HEADER);
  const headers = new Headers({
    "Cache-Control": !upstream.ok
      ? "no-store"
      : fallback
        ? "private, max-age=300"
        : poster
          ? "private, max-age=60"
          : "private, max-age=3600",
    Vary: "Accept",
    "X-Content-Type-Options": "nosniff",
  });
  const type = upstream.headers.get("content-type");
  if (upstream.ok && type) headers.set("Content-Type", type);
  if (fallback) {
    headers.set(FALLBACK_HEADER, "original");
    const length = upstream.headers.get("content-length");
    if (length && /^\d+$/.test(length)) headers.set("Content-Length", length);
  }
  return headers;
};
