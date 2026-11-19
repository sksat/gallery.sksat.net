/**
 * HTTP Range handling for serving a video from R2 (range.spec.ts): the
 * public /video/<public_id> (image Worker) and the admin's /play/<id> both
 * stream the playback copy with these rules, so browsers can seek.
 *
 * Only a single range is supported (what <video> asks for); a multi-range
 * request gets the whole object, which RFC 9110 allows.
 */

/** Bytes [offset, offset + length) of an object of `size` bytes. */
export type ByteRange = { offset: number; length: number };

/**
 * The range a `Range` header asks for, against an object of `size` bytes:
 * null for no (or an unsupported) Range header, i.e. the whole object;
 * "unsatisfiable" for a range outside it (416).
 */
export const parseRangeHeader = (
  header: string | null,
  size: number,
): ByteRange | null | "unsatisfiable" => {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Several ranges, other units, garbage: answer with the whole object.
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // The last N bytes.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    const length = Math.min(n, size);
    return size === 0 ? "unsatisfiable" : { offset: size - length, length };
  }
  const start = Number(m[1]);
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
};

/** Headers of a 206 for `range` of an object of `size` bytes. */
export const contentRange = (range: ByteRange, size: number): string =>
  `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;

/**
 * Whether a conditional `If-Range` lets the range apply: with no header
 * yes; with an ETag only when it is ours (strong comparison); a date is
 * not trusted (we send no Last-Modified-based validators), so no.
 */
export const ifRangeMatches = (
  ifRange: string | null,
  etag: string,
): boolean => {
  if (ifRange === null) return true;
  return ifRange.trim() === etag;
};

/** The response headers shared by 200, 206 and 304 answers. */
export const videoHeaders = (opts: {
  contentType: string;
  etag: string;
  cacheControl: string;
}): Headers => {
  const h = new Headers();
  h.set("Content-Type", opts.contentType);
  h.set("Accept-Ranges", "bytes");
  h.set("ETag", opts.etag);
  h.set("Cache-Control", opts.cacheControl);
  h.set("X-Content-Type-Options", "nosniff");
  return h;
};

/** An R2 object's httpEtag as a strong ETag header value. */
export const strongEtag = (httpEtag: string): string =>
  httpEtag.startsWith('"') ? httpEtag : `"${httpEtag}"`;

/** Whether If-None-Match names this ETag (or "*"). */
export const noneMatch = (header: string | null, etag: string): boolean => {
  if (!header) return false;
  return header
    .split(",")
    .map((s) => s.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === etag);
};

/** The parts of an R2 bucket used to serve a video. */
export type R2Like = {
  head(key: string): Promise<{
    size: number;
    httpEtag: string;
    httpMetadata?: { contentType?: string };
  } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{
    size: number;
    httpEtag: string;
    httpMetadata?: { contentType?: string };
    body: ReadableStream;
  } | null>;
};

/**
 * Answer a GET or HEAD for the R2 object `key` with Range support: 200,
 * 206 (Content-Range), 304 (If-None-Match), 416, or 404 when the object is
 * missing. One head() first (the size is needed to resolve the range),
 * then one ranged get() for a GET.
 */
export const serveVideo = async (
  bucket: R2Like,
  key: string,
  request: Request,
  cacheControl: string,
): Promise<Response> => {
  const head = await bucket.head(key);
  if (!head) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const etag = strongEtag(head.httpEtag);
  const headers = videoHeaders({
    contentType: head.httpMetadata?.contentType ?? "video/mp4",
    etag,
    cacheControl,
  });
  if (noneMatch(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const size = head.size;
  const asked = ifRangeMatches(request.headers.get("If-Range"), etag)
    ? parseRangeHeader(request.headers.get("Range"), size)
    : null;
  if (asked === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const range = asked ?? { offset: 0, length: size };
  headers.set("Content-Length", String(range.length));
  if (asked) headers.set("Content-Range", contentRange(range, size));
  const status = asked ? 206 : 200;
  if (request.method === "HEAD" || range.length === 0) {
    return new Response(null, { status, headers });
  }
  const object = await bucket.get(key, { range });
  if (!object) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(object.body, { status, headers });
};
