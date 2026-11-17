import { AwsClient } from "aws4fetch";
import { exportSnapshot } from "./db";
import type { AdminEnv } from "./env";

export type PublishResult = {
  /** Items in media.json. */
  count: number;
  /** Size of media.json. */
  bytes: number;
  /** Items in cameras.json. */
  cameraCount: number;
  uploadedAt: string;
  /** ETag of media.json. */
  etag: string | null;
};

export const publishMediaJson = async (
  db: D1Database,
  env: Pick<
    AdminEnv,
    | "B2_REGION"
    | "B2_BUCKET"
    | "B2_ENDPOINT"
    | "B2_ACCESS_KEY_ID"
    | "B2_SECRET_ACCESS_KEY"
  >,
): Promise<PublishResult> => {
  const snapshot = await exportSnapshot(db);

  const aws = new AwsClient({
    accessKeyId: env.B2_ACCESS_KEY_ID,
    secretAccessKey: env.B2_SECRET_ACCESS_KEY,
    region: env.B2_REGION,
    service: "s3",
  });

  // Path-style S3 URL (`endpoint/bucket/key`). Matches the
  // s3.us-west-002.backblazeb2.com form pinned in wrangler.jsonc. If the
  // endpoint is ever swapped to virtual-hosted style
  // (`bucket.endpoint/key`), update this construction in lockstep.
  const put = async (key: string, value: unknown) => {
    const body = new TextEncoder().encode(JSON.stringify(value));
    const url = `${env.B2_ENDPOINT.replace(/\/$/, "")}/${env.B2_BUCKET}/${key}`;
    const res = await aws.fetch(url, {
      method: "PUT",
      body,
      headers: {
        "content-type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `B2 PUT ${key} failed: ${res.status} ${res.statusText} ${text}`,
      );
    }
    return { bytes: body.byteLength, etag: res.headers.get("etag") };
  };

  // cameras.json first: a media.json pointing at a camera slug that the
  // public cameras.json does not have yet would show a dead camera link.
  // The reverse (a new camera with no photos yet) is harmless.
  await put("cameras.json", snapshot.cameras);
  const media = await put("media.json", snapshot.media);

  return {
    count: snapshot.media.length,
    bytes: media.bytes,
    cameraCount: snapshot.cameras.length,
    uploadedAt: new Date().toISOString(),
    etag: media.etag,
  };
};
