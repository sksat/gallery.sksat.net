import { describe, expect, it } from "vitest";
import { amzDatetime, canonicalRequest, presign, uriEncode } from "./sigv4";

const signatureOf = (url: string) =>
  new URL(url).searchParams.get("X-Amz-Signature");

describe("presign", () => {
  // "Example: Presigned URL" in AWS's SigV4 query-string auth docs:
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  it("matches AWS's published example", async () => {
    const url = await presign({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      datetime: "20130524T000000Z",
      expires: 86400,
    });
    expect(signatureOf(url)).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  // A path-style PUT with signed headers and a port, cross-checked with
  // aws4fetch 1.0.20 (sign with signQuery and allHeaders).
  it("signs a path-style PUT with extra headers like aws4fetch", async () => {
    const url = await presign({
      method: "PUT",
      url: "http://127.0.0.1:5290/sksat-gallery/VRChat/2026-11/VRChat_2026-11-18_01-02-03.456_3840x2160.png",
      region: "us-west-002",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret/KEY+example",
      datetime: "20261118T010203Z",
      expires: 600,
      headers: {
        "Content-Type": "image/png",
        "x-amz-meta-sha256": "ab".repeat(32),
      },
    });
    expect(signatureOf(url)).toBe(
      "b91570eadd29f164147d6facded6beeb9a321aca0bcec428aacd5a368aaa0ad5",
    );
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;x-amz-meta-sha256",
    );
  });

  it("encodes the path once per segment and sorts the query", () => {
    const { canonical } = canonicalRequest({
      method: "put",
      url: "https://s3.example.com/b/a%20b/c(1).png?z=1&a=x y",
      region: "r",
      accessKeyId: "K",
      secretAccessKey: "S",
      datetime: "20260101T000000Z",
      expires: 60,
    });
    const [method, path, query] = canonical.split("\n");
    expect(method).toBe("PUT");
    expect(path).toBe("/b/a%20b/c%281%29.png");
    expect(query.startsWith("X-Amz-Algorithm=")).toBe(true);
    expect(query.endsWith("&a=x%20y&z=1")).toBe(true);
    expect(canonical.endsWith("\nhost\nUNSIGNED-PAYLOAD")).toBe(true);
  });

  it("refuses a malformed time or expiry", async () => {
    const base = {
      method: "GET",
      url: "https://s3.example.com/b/k",
      region: "r",
      accessKeyId: "K",
      secretAccessKey: "S",
      datetime: "20260101T000000Z",
      expires: 60,
    };
    await expect(
      presign({ ...base, datetime: "2026-01-01T00:00:00Z" }),
    ).rejects.toThrow(/datetime/);
    await expect(presign({ ...base, expires: 0 })).rejects.toThrow(/expires/);
  });
});

describe("helpers", () => {
  it("uriEncode follows RFC 3986", () => {
    expect(uriEncode("a b/c~d!*'()")).toBe("a%20b%2Fc~d%21%2A%27%28%29");
  });

  it("amzDatetime drops separators and milliseconds", () => {
    expect(amzDatetime(new Date("2026-11-18T01:02:03.456Z"))).toBe(
      "20261118T010203Z",
    );
  });
});
