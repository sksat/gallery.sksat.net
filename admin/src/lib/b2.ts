// Upload access to the B2 bucket: presigned PUT URLs that the browser
// sends the original to directly (the admin never handles the bytes).
//
// The key is a B2 application key restricted to the bucket with "Write
// Only" access (writeFiles): it can upload, but cannot read, list or HEAD
// objects. So the admin checks an upload through the image Worker's
// AdminImage.stat, which has a read key (object-stat.ts, /api/upload/[id]).
// Production secrets only: preview deployments run unreviewed code.

import { amzDatetime, presign } from "./sigv4";
import { UPLOAD_URL_EXPIRES } from "./upload";

export type UploadConfig = {
  /** S3 endpoint, e.g. https://s3.us-west-002.backblazeb2.com */
  endpoint: string;
  bucket: string;
  region: string;
  keyId: string;
  applicationKey: string;
};

/** The upload settings, or null when any is missing (upload disabled). */
export const getUploadConfig = (
  platform: { env?: Record<string, unknown> } | undefined,
): UploadConfig | null => {
  const env = platform?.env ?? {};
  const str = (k: string) =>
    typeof env[k] === "string" && env[k] !== "" ? (env[k] as string) : null;
  const endpoint = str("B2_ENDPOINT");
  const bucket = str("B2_BUCKET");
  const region = str("B2_REGION");
  const keyId = str("B2_UPLOAD_KEY_ID");
  const applicationKey = str("B2_UPLOAD_APPLICATION_KEY");
  if (!endpoint || !bucket || !region || !keyId || !applicationKey) {
    return null;
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    region,
    keyId,
    applicationKey,
  };
};

/** Headers the browser must send with the PUT (they are signed). */
export const putHeaders = (
  contentType: string,
  sha256: string,
): Record<string, string> => ({
  "Content-Type": contentType,
  // Stored as the object's metadata, so the bucket itself records which
  // file this is.
  "x-amz-meta-sha256": sha256,
});

/** Presigned PUT of `file` (a validated bucket path starting with "/"). */
export const presignPut = (
  config: UploadConfig,
  file: string,
  headers: Record<string, string>,
  now: Date,
): Promise<string> =>
  presign({
    method: "PUT",
    // Path-style: <endpoint>/<bucket>/<file>.
    url: `${config.endpoint}/${config.bucket}${file}`,
    region: config.region,
    accessKeyId: config.keyId,
    secretAccessKey: config.applicationKey,
    datetime: amzDatetime(now),
    expires: UPLOAD_URL_EXPIRES,
    headers,
  });
