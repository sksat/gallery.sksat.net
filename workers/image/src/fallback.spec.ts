import { describe, expect, it } from "vitest";
import {
  FALLBACK_HEADER,
  fallsBackToSource,
  sourceContentType,
  sourceResponse,
} from "./fallback";

describe("fallsBackToSource", () => {
  it("is for the large presets only", () => {
    for (const preset of ["w1200", "w1920", "w2560", "w3840"] as const) {
      expect(fallsBackToSource(preset, 429)).toBe(true);
    }
    for (const preset of ["h240", "h480", "og", "og-site"] as const) {
      expect(fallsBackToSource(preset, 429)).toBe(false);
    }
  });

  it("covers every failure but a missing file", () => {
    for (const status of [200, 400, 403, 415, 429, 500, 502, 503]) {
      expect(fallsBackToSource("w1920", status)).toBe(true);
    }
    expect(fallsBackToSource("w1920", 404)).toBe(false);
  });
});

describe("sourceContentType", () => {
  it("goes by the extension", () => {
    expect(sourceContentType("/a.png")).toBe("image/png");
    expect(sourceContentType("/a.jpg")).toBe("image/jpeg");
    expect(sourceContentType("/a.JPEG")).toBe("image/jpeg");
  });

  it("never takes the bucket's type", () => {
    const res = sourceResponse(
      new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
      "/a.png",
    );
    expect(res?.headers.get("Content-Type")).toBe("image/png");
    expect(res?.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("sourceResponse", () => {
  const bucket = (status: number, headers: Record<string, string>) =>
    new Response(status === 200 ? "bytes" : null, { status, headers });

  it("streams the file with its type, private and marked", async () => {
    const res = sourceResponse(
      bucket(200, {
        "Content-Type": "image/png",
        "Content-Length": "5",
        ETag: '"abc"',
        "x-amz-meta-sha256": "ab",
        "Cache-Control": "public, max-age=86400",
      }),
      "/VRChat/a.png",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("bytes");
    expect(Object.fromEntries(res!.headers)).toEqual({
      "content-type": "image/png",
      "content-length": "5",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      [FALLBACK_HEADER.toLowerCase()]: "original",
    });
  });

  it("refuses anything but a 200", () => {
    expect(sourceResponse(bucket(404, {}), "/a.png")).toBeNull();
    expect(sourceResponse(bucket(403, {}), "/a.png")).toBeNull();
    expect(
      sourceResponse(bucket(206, { "Content-Length": "5" }), "/a.png"),
    ).toBeNull();
  });

  it("serves a file of any size, with or without a known length", () => {
    const huge = sourceResponse(
      bucket(200, { "Content-Length": String(500 * 1024 * 1024) }),
      "/a.png",
    );
    expect(huge?.headers.get("Content-Length")).toBe(String(500 * 1024 * 1024));
    const unknown = sourceResponse(bucket(200, {}), "/a.png");
    expect(unknown?.status).toBe(200);
    expect(unknown?.headers.get(FALLBACK_HEADER)).toBe("original");
    expect(unknown?.headers.get("Content-Length")).toBeNull();
    // An empty or encoded length is not passed on (it would cut the body).
    for (const headers of <Record<string, string>[]>[
      { "Content-Length": "" },
      { "Content-Length": "5", "Content-Encoding": "gzip" },
    ]) {
      const res = sourceResponse(bucket(200, headers), "/a.png");
      expect(res?.headers.get("Content-Length")).toBeNull();
    }
  });
});
