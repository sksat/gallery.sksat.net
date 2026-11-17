import { AwsClient } from "aws4fetch";
import { describe, expect, it } from "vitest";
import { originFor, PRESIGN_EXPIRES_SECONDS } from "./origin";

const PUBLIC = "https://sksat-gallery.s3.us-west-002.backblazeb2.com";
const FILE = "/VRChat/2023-12/a.png";

const signedEnv = {
  ORIGIN_BASE_URL: PUBLIC,
  B2_ENDPOINT: "https://s3.us-west-002.backblazeb2.com",
  B2_BUCKET: "sksat-gallery",
  B2_REGION: "us-west-002",
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "app-key",
};

describe("aws4fetch query signing", () => {
  it("matches AWS's published presigned URL example", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const client = new AwsClient({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      service: "s3",
      region: "us-east-1",
    });
    const signed = await client.sign(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Expires=86400",
      { method: "GET", aws: { signQuery: true, datetime: "20130524T000000Z" } },
    );
    expect(new URL(signed.url).searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("originFor", () => {
  it("uses the public bucket URL without credentials", async () => {
    expect(await originFor({ ORIGIN_BASE_URL: PUBLIC }, FILE)).toEqual({
      url: PUBLIC + FILE,
      cacheKey: PUBLIC + FILE,
    });
    // Half-configured counts as unset.
    expect(
      (await originFor({ ...signedEnv, B2_APPLICATION_KEY: "" }, FILE)).url,
    ).toBe(PUBLIC + FILE);
  });

  it("presigns a path-style GET with a short expiry", async () => {
    const { url, cacheKey } = await originFor(
      signedEnv,
      FILE,
      "20261118T000000Z",
    );
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://s3.us-west-002.backblazeb2.com/sksat-gallery/VRChat/2023-12/a.png",
    );
    const q = u.searchParams;
    expect(q.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(q.get("X-Amz-Credential")).toBe(
      "key-id/20261118/us-west-002/s3/aws4_request",
    );
    expect(q.get("X-Amz-Date")).toBe("20261118T000000Z");
    expect(q.get("X-Amz-Expires")).toBe(String(PRESIGN_EXPIRES_SECONDS));
    expect(q.get("X-Amz-SignedHeaders")).toBe("host");
    expect(q.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // The cache key carries no signature, and is the same as unsigned.
    expect(cacheKey).toBe(PUBLIC + FILE);
  });

  it("signs the same request the same way, another file differently", async () => {
    const a = await originFor(signedEnv, FILE, "20261118T000000Z");
    const b = await originFor(signedEnv, FILE, "20261118T000000Z");
    const c = await originFor(signedEnv, "/b.png", "20261118T000000Z");
    expect(a.url).toBe(b.url);
    expect(new URL(c.url).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(a.url).searchParams.get("X-Amz-Signature"),
    );
  });
});
