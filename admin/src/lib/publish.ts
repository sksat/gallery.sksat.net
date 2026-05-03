import { AwsClient } from "aws4fetch";
import { allMediaForExport } from "./db";
import type { AdminEnv } from "./env";

export type PublishResult = {
  count: number;
  bytes: number;
  uploadedAt: string;
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
  const items = await allMediaForExport(db);
  const body = JSON.stringify(items);
  const bodyBytes = new TextEncoder().encode(body);

  const aws = new AwsClient({
    accessKeyId: env.B2_ACCESS_KEY_ID,
    secretAccessKey: env.B2_SECRET_ACCESS_KEY,
    region: env.B2_REGION,
    service: "s3",
  });

  const url = `${env.B2_ENDPOINT.replace(/\/$/, "")}/${env.B2_BUCKET}/media.json`;
  const res = await aws.fetch(url, {
    method: "PUT",
    body: bodyBytes,
    headers: {
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`B2 PUT failed: ${res.status} ${res.statusText} ${text}`);
  }

  return {
    count: items.length,
    bytes: bodyBytes.byteLength,
    uploadedAt: new Date().toISOString(),
    etag: res.headers.get("etag"),
  };
};
