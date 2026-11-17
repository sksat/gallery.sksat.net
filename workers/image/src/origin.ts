/**
 * Where the Worker fetches an original from (tested with Vitest).
 *
 * With B2 credentials (a read-only application key restricted to the
 * bucket), the original is fetched through an S3 SigV4 presigned GET URL,
 * so the bucket itself can be private. Image Transformations fetches that
 * URL as the source image; the signature is in the query string, so no
 * headers need to be forwarded. Without credentials, the public bucket URL
 * is used as before.
 *
 * Image Transformations caches resized images under the source URL, and a
 * new source URL is a new transformation. `cf.cacheKey` cannot change that:
 * it is Enterprise-only and ignored on this plan. So the presigned URL has
 * to stay the same between requests: it is signed at the start of a fixed
 * window (`PRESIGN_WINDOW_SECONDS`) and stays valid past the window's end.
 * Each new window is a new source URL, i.e. one more resize per
 * (file, preset) every few days instead of one per request.
 */
import { AwsClient } from "aws4fetch";

export type OriginEnv = {
  /** Public base URL of the originals, without a trailing slash. */
  ORIGIN_BASE_URL: string;
  /** S3 endpoint of the bucket, e.g. https://s3.us-west-002.backblazeb2.com */
  B2_ENDPOINT?: string;
  B2_BUCKET?: string;
  B2_REGION?: string;
  /** Read-only application key (secrets). Both unset: public bucket. */
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
};

/** How long a presigned URL is valid: SigV4's maximum, 7 days. */
export const PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long one presigned URL is used. Shorter than its validity, so a URL
 * signed at the start of a window still has a day left at the window's end.
 */
export const PRESIGN_WINDOW_SECONDS = 6 * 24 * 60 * 60;

const hasCredentials = (env: OriginEnv): boolean =>
  Boolean(
    env.B2_KEY_ID &&
    env.B2_APPLICATION_KEY &&
    env.B2_ENDPOINT &&
    env.B2_BUCKET &&
    env.B2_REGION,
  );

/** Start of the signing window containing `nowMs`, as YYYYMMDDTHHMMSSZ. */
export const signingDatetime = (nowMs: number): string => {
  const windowMs = PRESIGN_WINDOW_SECONDS * 1000;
  const start = new Date(Math.floor(nowMs / windowMs) * windowMs);
  return start.toISOString().replace(/[:-]|\.\d{3}/g, "");
};

/**
 * URL of the original of `file` (a bucket path starting with "/", already
 * validated by parseImagePath). The same for every request within a
 * signing window. `nowMs` is for tests.
 */
export const originFor = async (
  env: OriginEnv,
  file: string,
  nowMs: number = Date.now(),
): Promise<string> => {
  if (!hasCredentials(env)) return env.ORIGIN_BASE_URL + file;

  const endpoint = env.B2_ENDPOINT!.replace(/\/$/, "");
  // Path-style: <endpoint>/<bucket>/<file>.
  const url = new URL(`${endpoint}/${env.B2_BUCKET}${file}`);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRES_SECONDS));
  const client = new AwsClient({
    accessKeyId: env.B2_KEY_ID!,
    secretAccessKey: env.B2_APPLICATION_KEY!,
    service: "s3",
    region: env.B2_REGION!,
  });
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true, datetime: signingDatetime(nowMs) },
  });
  return signed.url;
};
