import { AwsClient } from "aws4fetch";
import { describe, expect, it, vi } from "vitest";
import { sizeOf, STAT_EXPIRES_SECONDS, statObject, statUrl } from "./stat";

/** A fixed "now"; never Date.now(). */
const NOW = Date.UTC(2026, 10, 18, 12, 34, 56);
const FILE = "/VRChat/2026-11/a.png";
const PUBLIC = "https://sksat-gallery.s3.us-west-002.backblazeb2.com";
const SHA = "ff".repeat(32);

const signedEnv = {
  ORIGIN_BASE_URL: PUBLIC,
  B2_ENDPOINT: "https://s3.us-west-002.backblazeb2.com/",
  B2_BUCKET: "sksat-gallery",
  B2_REGION: "us-west-002",
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "app-key",
};

describe("statUrl", () => {
  it("presigns a short-lived GET on the bucket", async () => {
    const url = new URL(await statUrl(signedEnv, FILE, NOW));
    expect(url.origin + url.pathname).toBe(
      "https://s3.us-west-002.backblazeb2.com/sksat-gallery/VRChat/2026-11/a.png",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe(
      String(STAT_EXPIRES_SECONDS),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    const expected = await new AwsClient({
      accessKeyId: "key-id",
      secretAccessKey: "app-key",
      service: "s3",
      region: "us-west-002",
    }).sign(
      `https://s3.us-west-002.backblazeb2.com/sksat-gallery${FILE}?X-Amz-Expires=${STAT_EXPIRES_SECONDS}`,
      { method: "GET", aws: { signQuery: true, datetime: "20261118T123456Z" } },
    );
    expect(url.toString()).toBe(expected.url);
  });

  it("uses the public URL without credentials", async () => {
    expect(await statUrl({ ORIGIN_BASE_URL: PUBLIC }, FILE, NOW)).toBe(
      PUBLIC + FILE,
    );
  });
});

describe("sizeOf", () => {
  const res = (status: number, headers: Record<string, string>) =>
    new Response(status === 416 ? null : "x", { status, headers });

  it("reads the total from Content-Range, or a full response's length", () => {
    expect(sizeOf(res(206, { "content-range": "bytes 0-0/3500000" }))).toBe(
      3500000,
    );
    expect(sizeOf(res(416, { "content-range": "bytes */0" }))).toBe(0);
    expect(sizeOf(res(200, { "content-length": "42" }))).toBe(42);
    // A partial response's length is the part, not the object.
    expect(sizeOf(res(206, { "content-length": "1" }))).toBeNull();
    expect(sizeOf(res(206, { "content-range": "bytes 0-0/*" }))).toBeNull();
  });
});

describe("statObject", () => {
  /** A fetch that answers like S3 to a one-byte range request. */
  const s3 = (status: number, headers: Record<string, string> = {}) => {
    const cancelled = vi.fn();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([0x89]));
        c.close();
      },
      cancel: cancelled,
    });
    const f = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(status === 404 ? "NoSuchKey" : body, { status, headers }),
    );
    return { f, cancelled };
  };

  it("asks for the first byte and reports size, etag and the sha256 metadata", async () => {
    const { f } = s3(206, {
      "content-range": "bytes 0-0/3500000",
      etag: '"abc"',
      "x-amz-meta-sha256": SHA,
    });
    expect(await statObject(signedEnv, FILE, f, NOW)).toEqual({
      size: 3500000,
      etag: '"abc"',
      sha256: SHA,
    });
    const init = f.mock.calls[0][1];
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Range: "bytes=0-0" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels the body of a server that ignores the range", async () => {
    const { f, cancelled } = s3(200, { "content-length": "3500000" });
    expect((await statObject(signedEnv, FILE, f, NOW))?.size).toBe(3500000);
    expect(cancelled).toHaveBeenCalled();
  });

  it("is null when there is no object, and throws on other errors", async () => {
    expect(await statObject(signedEnv, FILE, s3(404).f, NOW)).toBeNull();
    await expect(statObject(signedEnv, FILE, s3(403).f, NOW)).rejects.toThrow(
      "403",
    );
  });

  // Regression: a request that never answers must become an error the
  // admin retries, not a hung Worker.
  it("gives up after the timeout", async () => {
    const never = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_ok, fail) =>
          init?.signal?.addEventListener("abort", () =>
            fail(init.signal?.reason),
          ),
        ),
    );
    await expect(
      statObject(signedEnv, FILE, never as typeof fetch, NOW, 20),
    ).rejects.toThrow();
  });
});
