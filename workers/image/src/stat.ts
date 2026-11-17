/**
 * What the bucket has at a path, for the admin's upload check (the
 * AdminImage entrypoint's `stat`; tested with Vitest).
 *
 * The admin's upload key is B2 "Write Only" and cannot read the bucket;
 * this Worker's key can. So the admin asks here, after the browser's PUT,
 * whether the object exists with the size and SHA-256 metadata it
 * announced, before it marks the photo ready.
 *
 * A HEAD through a short-lived presigned URL (credentials), or on the public
 * bucket URL (none). Never cached.
 */
import { AwsClient } from "aws4fetch";
import type { OriginEnv } from "./origin";

export type ObjectStat = {
  size: number;
  etag: string | null;
  /** The `x-amz-meta-sha256` the uploader stored, if any. */
  sha256: string | null;
};

/** How long the HEAD URL is valid. */
export const STAT_EXPIRES_SECONDS = 60;

/** URL to HEAD `file` (a validated bucket path starting with "/"). */
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
  const signed = await client.sign(url.toString(), {
    method: "HEAD",
    aws: { signQuery: true, datetime },
  });
  return signed.url;
};

/** The object at `file`, null if there is none; throws on other errors. */
export const statObject = async (
  env: OriginEnv,
  file: string,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<ObjectStat | null> => {
  // HEAD responses are not cached by Cloudflare, and the URL is new each time.
  const res = await fetchFn(await statUrl(env, file, nowMs), {
    method: "HEAD",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${file}: ${res.status}`);
  const size = Number(res.headers.get("content-length"));
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`HEAD ${file}: no content-length`);
  }
  return {
    size,
    etag: res.headers.get("etag"),
    sha256: res.headers.get("x-amz-meta-sha256"),
  };
};
