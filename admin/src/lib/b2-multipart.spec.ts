import { describe, expect, it } from "vitest";
import type { UploadConfig } from "./b2";
import {
  abortMultipart,
  B2Error,
  completeMultipart,
  completeXml,
  createMultipart,
  listParts,
  parseListParts,
  presignParts,
} from "./b2-multipart";

const config: UploadConfig = {
  endpoint: "https://s3.us-west-002.backblazeb2.com",
  bucket: "sksat-gallery",
  region: "us-west-002",
  keyId: "key",
  applicationKey: "secret",
};
const now = () => new Date("2026-11-18T01:02:03Z");

type Call = { method: string; url: URL; headers: Headers; body: string };
const recorder = (answer: (c: Call) => Response) => {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(c);
    return answer(c);
  }) as typeof fetch;
  return { calls, fetchFn };
};

const page = (parts: [number, string, number][], next?: number) =>
  `<ListPartsResult><IsTruncated>${next ? "true" : "false"}</IsTruncated>${
    next ? `<NextPartNumberMarker>${next}</NextPartNumberMarker>` : ""
  }${parts
    .map(
      ([n, e, s]) =>
        `<Part><PartNumber>${n}</PartNumber><ETag>${e}</ETag><Size>${s}</Size></Part>`,
    )
    .join("")}</ListPartsResult>`;

describe("B2 multipart calls", () => {
  it("creates an upload with the object's type and hash signed in", async () => {
    const { calls, fetchFn } = recorder(
      () =>
        new Response(
          "<InitiateMultipartUploadResult><UploadId>4_zabc</UploadId></InitiateMultipartUploadResult>",
        ),
    );
    const headers = { "Content-Type": "video/mp4", "x-amz-meta-sha256": "ab" };
    expect(
      await createMultipart(config, "/v/a.mp4", headers, { fetchFn, now }),
    ).toBe("4_zabc");
    const [c] = calls;
    expect(c.method).toBe("POST");
    expect(c.url.pathname).toBe("/sksat-gallery/v/a.mp4");
    expect(c.url.searchParams.has("uploads")).toBe(true);
    expect(c.url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;x-amz-meta-sha256",
    );
    expect(c.headers.get("x-amz-meta-sha256")).toBe("ab");
  });

  it("lists every page of parts, and null for an upload that is gone", async () => {
    const { calls, fetchFn } = recorder((c) =>
      c.url.searchParams.get("part-number-marker") === "1"
        ? new Response(page([[2, "&quot;e2&quot;", 5]]))
        : new Response(page([[1, '"e1"', 10]], 1)),
    );
    expect(await listParts(config, "/v/a.mp4", "up", { fetchFn, now })).toEqual(
      [
        { partNumber: 1, etag: '"e1"', size: 10 },
        { partNumber: 2, etag: '"e2"', size: 5 },
      ],
    );
    expect(calls[0].url.searchParams.get("uploadId")).toBe("up");
    const gone = recorder(() => new Response("NoSuchUpload", { status: 404 }));
    expect(
      await listParts(config, "/v/a.mp4", "up", { fetchFn: gone.fetchFn, now }),
    ).toBeNull();
    const denied = recorder(() => new Response("", { status: 403 }));
    await expect(
      listParts(config, "/v/a.mp4", "up", { fetchFn: denied.fetchFn, now }),
    ).rejects.toBeInstanceOf(B2Error);
  });

  it("completes with the parts in order, and fails on a late <Error>", async () => {
    const { calls, fetchFn } = recorder(() => new Response("<Done/>"));
    const parts = [
      { partNumber: 2, etag: '"b"', size: 1 },
      { partNumber: 1, etag: '"a&"', size: 1 },
    ];
    await completeMultipart(config, "/v/a.mp4", "up", parts, { fetchFn, now });
    expect(calls[0].body).toBe(completeXml(parts));
    expect(calls[0].body).toBe(
      "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;a&amp;&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part></CompleteMultipartUpload>",
    );
    const late = recorder(() => new Response("<Error><Code>X</Code></Error>"));
    await expect(
      completeMultipart(config, "/v/a.mp4", "up", parts, {
        fetchFn: late.fetchFn,
        now,
      }),
    ).rejects.toBeInstanceOf(B2Error);
  });

  it("aborts, and an upload already gone is fine", async () => {
    const { calls, fetchFn } = recorder(
      () => new Response(null, { status: 404 }),
    );
    await abortMultipart(config, "/v/a.mp4", "up", { fetchFn, now });
    expect(calls[0].method).toBe("DELETE");
  });

  it("signs part URLs for the browser, an hour each", async () => {
    const urls = await presignParts(config, "/v/a.mp4", "up", [1, 3], now);
    expect(urls.map((u) => u.partNumber)).toEqual([1, 3]);
    const u = new URL(urls[1].url);
    expect(u.searchParams.get("partNumber")).toBe("3");
    expect(u.searchParams.get("uploadId")).toBe("up");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("reads a part list's escaped ETags", () => {
    expect(parseListParts(page([[1, "&quot;x&quot;", 3]])).parts).toEqual([
      { partNumber: 1, etag: '"x"', size: 3 },
    ]);
  });
});
