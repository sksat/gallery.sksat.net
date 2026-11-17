import { AwsClient } from "aws4fetch";
import { describe, expect, it, vi } from "vitest";
import { STAT_EXPIRES_SECONDS, statObject, statUrl } from "./stat";

/** A fixed "now"; never Date.now(). */
const NOW = Date.UTC(2026, 10, 18, 12, 34, 56);
const FILE = "/VRChat/2026-11/a.png";
const PUBLIC = "https://sksat-gallery.s3.us-west-002.backblazeb2.com";

const signedEnv = {
  ORIGIN_BASE_URL: PUBLIC,
  B2_ENDPOINT: "https://s3.us-west-002.backblazeb2.com/",
  B2_BUCKET: "sksat-gallery",
  B2_REGION: "us-west-002",
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "app-key",
};

describe("statUrl", () => {
  it("presigns a short-lived HEAD on the bucket", async () => {
    const url = new URL(await statUrl(signedEnv, FILE, NOW));
    expect(url.origin + url.pathname).toBe(
      "https://s3.us-west-002.backblazeb2.com/sksat-gallery/VRChat/2026-11/a.png",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe(
      String(STAT_EXPIRES_SECONDS),
    );
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261118T123456Z");
    // The same signature aws4fetch gives a HEAD (not a GET) request.
    const expected = await new AwsClient({
      accessKeyId: "key-id",
      secretAccessKey: "app-key",
      service: "s3",
      region: "us-west-002",
    }).sign(
      `https://s3.us-west-002.backblazeb2.com/sksat-gallery${FILE}?X-Amz-Expires=${STAT_EXPIRES_SECONDS}`,
      {
        method: "HEAD",
        aws: { signQuery: true, datetime: "20261118T123456Z" },
      },
    );
    expect(url.toString()).toBe(expected.url);
  });

  it("uses the public URL without credentials", async () => {
    expect(await statUrl({ ORIGIN_BASE_URL: PUBLIC }, FILE, NOW)).toBe(
      PUBLIC + FILE,
    );
  });
});

describe("statObject", () => {
  const fetchReturning = (res: Response) =>
    vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => res);

  it("reports size, etag and the sha256 metadata", async () => {
    const f = fetchReturning(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "1234",
          etag: '"abc"',
          "x-amz-meta-sha256": "ff".repeat(32),
        },
      }),
    );
    expect(await statObject(signedEnv, FILE, f, NOW)).toEqual({
      size: 1234,
      etag: '"abc"',
      sha256: "ff".repeat(32),
    });
    expect(f.mock.calls[0][1]).toEqual({ method: "HEAD" });
  });

  it("is null when there is no object, and throws on other errors", async () => {
    expect(
      await statObject(
        signedEnv,
        FILE,
        fetchReturning(new Response(null, { status: 404 })),
        NOW,
      ),
    ).toBeNull();
    await expect(
      statObject(
        signedEnv,
        FILE,
        fetchReturning(new Response(null, { status: 403 })),
        NOW,
      ),
    ).rejects.toThrow("403");
  });
});
