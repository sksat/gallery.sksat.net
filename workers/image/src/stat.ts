/**
 * What the bucket has at a path, for the admin's upload check (the
 * AdminImage entrypoint's `stat`; tested with Vitest).
 *
 * The admin's upload key is B2 "Write Only" and cannot read the bucket;
 * this Worker's key can. So the admin asks here, after the browser's PUT,
 * whether the object exists with the size and SHA-256 metadata it
 * announced, before it marks the photo ready.
 *
 * A GET of the first byte (`Range: bytes=0-0`) through a short-lived
 * presigned URL (credentials), or on the public bucket URL (none): the size
 * comes from Content-Range, the metadata from the headers, and the one-byte
 * body is read so nothing is left open. Not a HEAD: in production every
 * `stat` call ended with the runtime reporting the Worker as hung, and its
 * only subrequest was that HEAD (an empty body with a non-zero
 * Content-Length), while `image`'s GETs work. A timeout turns any other
 * stall into an error the admin can retry.
 */
import { AwsClient } from "aws4fetch";
import type { OriginEnv } from "./origin";

export type ObjectStat = {
  size: number;
  etag: string | null;
  /** The `x-amz-meta-sha256` the uploader stored, if any. */
  sha256: string | null;
};

/** How long the URL is valid. */
export const STAT_EXPIRES_SECONDS = 60;

/** Give up on the bucket after this long. */
export const STAT_TIMEOUT_MS = 10_000;

/** URL to GET `file` (a validated bucket path starting with "/"). */
export const statUrl = async (
  env: OriginEnv,
  file: string,
  nowMs: number,
): Promise<string> => {
  if (
    !env.B2_KEY_ID ||
    !env.B2_APPLICATION_KEY ||
    !env.B2_ENDPOINT ||
    !env.B2_BUCKET ||
    !env.B2_REGION
  ) {
    return env.ORIGIN_BASE_URL + file;
  }
  const endpoint = env.B2_ENDPOINT.replace(/\/$/, "");
  const url = new URL(`${endpoint}/${env.B2_BUCKET}${file}`);
  url.searchParams.set("X-Amz-Expires", String(STAT_EXPIRES_SECONDS));
  const client = new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APPLICATION_KEY,
    service: "s3",
    region: env.B2_REGION,
  });
  const datetime = new Date(nowMs).toISOString().replace(/[:-]|\.\d{3}/g, "");
  // Only `host` is signed: the Range header may be added freely.
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true, datetime },
  });
  return signed.url;
};

/**
 * Total size from a ranged response: "bytes 0-0/3500000" → 3500000; a
 * full (200) response's Content-Length; null when neither says.
 */
export const sizeOf = (res: Response): number | null => {
  const range = res.headers.get("content-range");
  // "bytes */0" is an empty object's answer to a range (416).
  const m = range ? /^bytes (?:\d+-\d+|\*)\/(\d+)$/.exec(range.trim()) : null;
  const raw = m
    ? m[1]
    : res.status === 200
      ? res.headers.get("content-length")
      : null;
  const n = raw === null ? NaN : Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** The object at `file`, null if there is none; throws on other errors. */
export const statObject = async (
  env: OriginEnv,
  file: string,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
  timeoutMs: number = STAT_TIMEOUT_MS,
): Promise<ObjectStat | null> => {
  const res = await fetchFn(await statUrl(env, file, nowMs), {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Drain the (one-byte) body either way; a 200 from a server that ignored
  // the range is cancelled instead of read.
  const settle = () =>
    res.status === 200 ? res.body?.cancel() : res.arrayBuffer();
  try {
    if (res.status === 404) return null;
    if (res.status !== 206 && res.status !== 200 && res.status !== 416) {
      throw new Error(`GET ${file} (range): ${res.status}`);
    }
    const size = sizeOf(res);
    if (size === null) throw new Error(`GET ${file}: no size`);
    return {
      size,
      etag: res.headers.get("etag"),
      sha256: res.headers.get("x-amz-meta-sha256"),
    };
  } finally {
    await Promise.resolve(settle()).catch(() => {});
  }
};
