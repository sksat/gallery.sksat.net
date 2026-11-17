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
 * The signature changes on every request, so the transformation cache is
 * keyed on the bucket and file only (`cacheKey`).
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

/** How long a presigned URL is valid. Only the transformation uses it. */
export const PRESIGN_EXPIRES_SECONDS = 300;

export type Origin = {
  /** URL to fetch the original from. */
  url: string;
  /** Cache key for the transformation: never includes a signature. */
  cacheKey: string;
};

const hasCredentials = (env: OriginEnv): boolean =>
  Boolean(
    env.B2_KEY_ID &&
    env.B2_APPLICATION_KEY &&
    env.B2_ENDPOINT &&
    env.B2_BUCKET &&
    env.B2_REGION,
  );

/**
 * The original of `file` (a bucket path starting with "/", already
 * validated by parseImagePath). `datetime` (YYYYMMDDTHHMMSSZ) is for tests.
 */
export const originFor = async (
  env: OriginEnv,
  file: string,
  datetime?: string,
): Promise<Origin> => {
  const publicUrl = env.ORIGIN_BASE_URL + file;
  if (!hasCredentials(env)) return { url: publicUrl, cacheKey: publicUrl };

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
    aws: { signQuery: true, ...(datetime ? { datetime } : {}) },
  });
  // The same key whether the bucket is reached publicly or signed, so the
  // cache survives the switch.
  return { url: signed.url, cacheKey: publicUrl };
};
