import { describe, expect, it, vi } from "vitest";
import {
  MAX_RANGE_BYTES,
  parseRange,
  rangeHeader,
  readObjectBytes,
} from "./bytes";

const NOW = Date.UTC(2026, 10, 18, 12, 34, 56);
const FILE = "/VRChat/2026-11/a.png";
const PUBLIC = "https://sksat-gallery.s3.us-west-002.backblazeb2.com";
const env = { ORIGIN_BASE_URL: PUBLIC };

describe("parseRange", () => {
  it("accepts a head or a tail up to the cap", () => {
    expect(parseRange({ offset: 0, length: 65536 })).toEqual({
      offset: 0,
      length: 65536,
    });
    expect(parseRange({ suffix: MAX_RANGE_BYTES })).toEqual({
      suffix: MAX_RANGE_BYTES,
    });
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "0-10",
      { offset: -1, length: 10 },
      { offset: 0, length: 0 },
      { offset: 0, length: MAX_RANGE_BYTES + 1 },
      { offset: 0.5, length: 10 },
      { suffix: 0 },
      { suffix: MAX_RANGE_BYTES + 1 },
    ]) {
      expect(parseRange(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("rangeHeader", () => {
  it("writes inclusive byte ranges", () => {
    expect(rangeHeader({ offset: 0, length: 10 })).toBe("bytes=0-9");
    expect(rangeHeader({ suffix: 100 })).toBe("bytes=-100");
  });
});

describe("readObjectBytes", () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);

  it("returns the part and the object's size", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(bytes.subarray(0, 4), {
          status: 206,
          headers: { "content-range": "bytes 0-3/10" },
        }),
    );
    const got = await readObjectBytes(
      env,
      FILE,
      { offset: 0, length: 4 },
      fetchFn,
      NOW,
    );
    expect(got).toEqual({ bytes: bytes.subarray(0, 4), size: 10 });
    expect(fetchFn).toHaveBeenCalledWith(
      PUBLIC + FILE,
      expect.objectContaining({ headers: { Range: "bytes=0-3" } }),
    );
  });

  it("reads only the head of a server that ignores the range", async () => {
    const fetchFn = async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-length": "10" },
      });
    expect(
      await readObjectBytes(env, FILE, { offset: 0, length: 3 }, fetchFn, NOW),
    ).toEqual({ bytes: bytes.subarray(0, 3), size: 10 });
    await expect(
      readObjectBytes(env, FILE, { suffix: 3 }, fetchFn, NOW),
    ).rejects.toThrow(/range ignored/);
  });

  it("is null for a missing object, empty past the end, and throws otherwise", async () => {
    expect(
      await readObjectBytes(
        env,
        FILE,
        { suffix: 3 },
        async () => new Response("no", { status: 404 }),
        NOW,
      ),
    ).toBeNull();
    expect(
      await readObjectBytes(
        env,
        FILE,
        { offset: 20, length: 3 },
        async () =>
          new Response(null, {
            status: 416,
            headers: { "content-range": "bytes */10" },
          }),
        NOW,
      ),
    ).toEqual({ bytes: new Uint8Array(0), size: 10 });
    await expect(
      readObjectBytes(
        env,
        FILE,
        { suffix: 3 },
        async () => new Response("x", { status: 500 }),
        NOW,
      ),
    ).rejects.toThrow(/500/);
  });
});
