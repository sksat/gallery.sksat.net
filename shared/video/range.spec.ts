import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";
import {
  contentRange,
  ifRangeMatches,
  noneMatch,
  parseRangeHeader,
  serveVideo,
  type R2Like,
} from "./range";

describe("parseRangeHeader", () => {
  it("reads one range: from-to, from-, and the last N bytes", () => {
    expect(parseRangeHeader("bytes=0-99", 1000)).toEqual({
      offset: 0,
      length: 100,
    });
    expect(parseRangeHeader("bytes=900-", 1000)).toEqual({
      offset: 900,
      length: 100,
    });
    expect(parseRangeHeader("bytes=990-5000", 1000)).toEqual({
      offset: 990,
      length: 10,
    });
    expect(parseRangeHeader("bytes=-100", 1000)).toEqual({
      offset: 900,
      length: 100,
    });
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({
      offset: 0,
      length: 1000,
    });
  });

  it("answers the whole object for no, several or odd ranges", () => {
    for (const h of [
      null,
      "",
      "bytes=0-1,5-6",
      "items=0-1",
      "bytes=-",
      "bytes=5-1",
    ]) {
      expect(parseRangeHeader(h, 1000), String(h)).toBeNull();
    }
  });

  it("refuses a range past the end", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("writes Content-Range and compares validators", () => {
    expect(contentRange({ offset: 100, length: 100 }, 1000)).toBe(
      "bytes 100-199/1000",
    );
    expect(ifRangeMatches(null, '"e"')).toBe(true);
    expect(ifRangeMatches('"e"', '"e"')).toBe(true);
    expect(ifRangeMatches('W/"e"', '"e"')).toBe(false);
    expect(ifRangeMatches("Wed, 21 Oct 2015 07:28:00 GMT", '"e"')).toBe(false);
    expect(noneMatch('"a", W/"e"', '"e"')).toBe(true);
    expect(noneMatch("*", '"e"')).toBe(true);
    expect(noneMatch(null, '"e"')).toBe(false);
  });
});

describe("serveVideo", () => {
  const data = new TextEncoder().encode("0123456789");
  const gets: unknown[] = [];
  const bucket: R2Like = {
    head: async (key) =>
      key === "v/a.mp4"
        ? {
            size: 10,
            httpEtag: '"abc"',
            httpMetadata: { contentType: "video/mp4" },
          }
        : null,
    get: async (key, options) => {
      gets.push(options?.range ?? null);
      if (key !== "v/a.mp4") return null;
      const r = options?.range ?? { offset: 0, length: 10 };
      return {
        size: 10,
        httpEtag: '"abc"',
        body: new Response(data.slice(r.offset, r.offset + r.length)).body!,
      };
    },
  };
  const get = (headers: Record<string, string> = {}, method = "GET") =>
    serveVideo(
      bucket,
      "v/a.mp4",
      new Request("https://x/video/a", { method, headers }),
      "public, max-age=60",
    );

  it("streams the whole object, with its validators", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "accept-ranges": "bytes",
      "content-length": "10",
      "content-type": "video/mp4",
      etag: '"abc"',
      "cache-control": "public, max-age=60",
    });
  });

  it("answers a range with 206 and reads only that range", async () => {
    gets.length = 0;
    const res = await get({ Range: "bytes=2-4" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(res.headers.get("content-length")).toBe("3");
    expect(await res.text()).toBe("234");
    expect(gets).toEqual([{ offset: 2, length: 3 }]);
  });

  it("416, 304, HEAD without a body read, 404", async () => {
    const past = await get({ Range: "bytes=10-" });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");
    expect((await get({ "If-None-Match": '"abc"' })).status).toBe(304);
    // A changed object: If-Range no longer matches, the whole object.
    expect(
      (await get({ Range: "bytes=2-4", "If-Range": '"old"' })).status,
    ).toBe(200);
    gets.length = 0;
    const head = await get({ Range: "bytes=0-0" }, "HEAD");
    expect(head.status).toBe(206);
    expect(gets).toEqual([]);
    const missing = await serveVideo(
      bucket,
      "v/none.mp4",
      new Request("https://x/"),
      "public",
    );
    expect(missing.status).toBe(404);
  });
});

describe("formatDuration", () => {
  it("is m:ss, or h:mm:ss from an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(1499)).toBe("0:01");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});
