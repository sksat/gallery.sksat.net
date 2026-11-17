import { AwsClient } from "aws4fetch";
import { describe, expect, it } from "vitest";
import {
  originFor,
  PRESIGN_EXPIRES_SECONDS,
  PRESIGN_WINDOW_SECONDS,
  signingDatetime,
} from "./origin";

/** A fixed "now" (2026-11-18T12:34:56Z); never Date.now(). */
const NOW = Date.UTC(2026, 10, 18, 12, 34, 56);

/** signingDatetime as epoch milliseconds. */
const windowStartMs = (now: number): number => {
  const d = signingDatetime(now);
  return Date.parse(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 11)}:${d.slice(11, 13)}:${d.slice(13)}`,
  );
};

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
    expect(await originFor({ ORIGIN_BASE_URL: PUBLIC }, FILE)).toBe(
      PUBLIC + FILE,
    );
    // Half-configured counts as unset.
    expect(
      await originFor({ ...signedEnv, B2_APPLICATION_KEY: "" }, FILE),
    ).toBe(PUBLIC + FILE);
  });

  it("presigns a path-style GET at the start of the signing window", async () => {
    const url = await originFor(signedEnv, FILE, NOW);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://s3.us-west-002.backblazeb2.com/sksat-gallery/VRChat/2023-12/a.png",
    );
    const q = u.searchParams;
    expect(q.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(q.get("X-Amz-Credential")).toBe(
      "key-id/20261115/us-west-002/s3/aws4_request",
    );
    // 2026-11-15 is the start of the 6-day window (counted from the epoch).
    expect(q.get("X-Amz-Date")).toBe("20261115T000000Z");
    expect(q.get("X-Amz-Expires")).toBe(String(PRESIGN_EXPIRES_SECONDS));
    expect(q.get("X-Amz-SignedHeaders")).toBe("host");
    expect(q.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the URL stable within a window, another file differently", async () => {
    const start = windowStartMs(NOW);
    const a = await originFor(signedEnv, FILE, start);
    const b = await originFor(
      signedEnv,
      FILE,
      start + PRESIGN_WINDOW_SECONDS * 1000 - 1,
    );
    const c = await originFor(signedEnv, "/b.png", start);
    expect(a).toBe(b);
    expect(new URL(c).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(a).searchParams.get("X-Amz-Signature"),
    );
  });

  it("signs anew in the next window", async () => {
    const start = windowStartMs(NOW);
    const a = await originFor(signedEnv, FILE, start);
    const next = await originFor(
      signedEnv,
      FILE,
      start + PRESIGN_WINDOW_SECONDS * 1000,
    );
    expect(next).not.toBe(a);
  });
});

describe("signingDatetime", () => {
  it("is never in the future and leaves a day of validity at the window's end", () => {
    for (const now of [NOW, windowStartMs(NOW), windowStartMs(NOW) - 1]) {
      const signedAt = windowStartMs(now);
      expect(signedAt).toBeLessThanOrEqual(now);
      // Valid until signedAt + expiry; the URL is used until the window ends.
      const lastUse = signedAt + PRESIGN_WINDOW_SECONDS * 1000;
      expect(
        signedAt + PRESIGN_EXPIRES_SECONDS * 1000 - lastUse,
      ).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    }
    expect(PRESIGN_EXPIRES_SECONDS).toBeLessThanOrEqual(604800); // SigV4 max
  });

  it("formats as an ISO 8601 basic datetime", () => {
    expect(signingDatetime(Date.UTC(1970, 0, 7, 12))).toBe("19700107T000000Z");
  });
});
