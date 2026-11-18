/**
 * A few bytes of an original, for the admin's metadata backfill (the
 * AdminImage entrypoint's `bytes`; tested with Vitest).
 *
 * EXIF sits in a JPEG's first 64 KB and a PNG's text chunks either before
 * the image data or at the very end, so the admin asks for the first and,
 * if needed, the last bytes of a file instead of the whole (up to ~40 MB)
 * original. One ranged GET through the same short-lived presigned URL as
 * `stat` (stat.ts), capped at MAX_RANGE_BYTES.
 */
import type { OriginEnv } from "./origin";
import { sizeOf, statUrl, STAT_TIMEOUT_MS } from "./stat";

/** The most a single call returns. */
export const MAX_RANGE_BYTES = 256 * 1024;

/** From `offset`, `length` bytes; or the last `suffix` bytes. */
export type ByteRange = { offset: number; length: number } | { suffix: number };

export type ObjectBytes = {
  /** The bytes read (fewer than asked at the end of the file). */
  bytes: Uint8Array;
  /** The whole object's size. */
  size: number;
};

const okCount = (n: unknown, min: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min;

/** A range from the RPC's arguments (any shape), or null. */
export const parseRange = (v: unknown): ByteRange | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if ("suffix" in o) {
    return okCount(o.suffix, 1) && o.suffix <= MAX_RANGE_BYTES
      ? { suffix: o.suffix }
      : null;
  }
  return okCount(o.offset, 0) &&
    okCount(o.length, 1) &&
    o.length <= MAX_RANGE_BYTES
    ? { offset: o.offset, length: o.length }
    : null;
};

/** The Range header for a range. */
export const rangeHeader = (r: ByteRange): string =>
  "suffix" in r
    ? `bytes=-${r.suffix}`
    : `bytes=${r.offset}-${r.offset + r.length - 1}`;

/** Read at most `max` bytes of a body, then cancel the rest. */
const readAtMost = async (
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array> => {
  const out = new Uint8Array(max);
  let n = 0;
  if (!body) return out.subarray(0, 0);
  const reader = body.getReader();
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, max - n);
      out.set(value.subarray(0, take), n);
      n += take;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.subarray(0, n);
};

/** `range` of the object at `file`; null if there is none. Throws otherwise. */
export const readObjectBytes = async (
  env: OriginEnv,
  file: string,
  range: ByteRange,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
  timeoutMs: number = STAT_TIMEOUT_MS,
): Promise<ObjectBytes | null> => {
  const res = await fetchFn(await statUrl(env, file, nowMs), {
    method: "GET",
    headers: { Range: rangeHeader(range) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (res.status === 416) {
    // Past the end (or an empty object): nothing to read.
    await res.arrayBuffer().catch(() => {});
    return { bytes: new Uint8Array(0), size: sizeOf(res) ?? 0 };
  }
  if (res.status !== 206 && res.status !== 200) {
    await res.body?.cancel();
    throw new Error(`GET ${file} (range): ${res.status}`);
  }
  const size = sizeOf(res);
  if (size === null) {
    await res.body?.cancel();
    throw new Error(`GET ${file}: no size`);
  }
  // A server that ignored the range sent the whole file: its start is
  // still the head, but anything else would mean reading it all.
  if (res.status === 200 && ("suffix" in range || range.offset > 0)) {
    await res.body?.cancel();
    throw new Error(`GET ${file}: range ignored`);
  }
  const max = "suffix" in range ? range.suffix : range.length;
  return { bytes: await readAtMost(res.body, max), size };
};
