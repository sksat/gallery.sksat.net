import { describe, it, expect } from "vitest";
import {
  formatTaken,
  parseMediaItem,
  parseMediaList,
  parseMediaTimestamp,
  transformMediaInfo,
} from "./types";
import type { MediaInfoJSON } from "./types";

describe("parseMediaTimestamp", () => {
  it("should return null for null input", () => {
    expect(parseMediaTimestamp(null)).toBeNull();
  });

  it("should return null for invalid date string", () => {
    expect(parseMediaTimestamp("invalid-date")).toBeNull();
  });

  it("should return Date object for valid ISO 8601 string", () => {
    const result = parseMediaTimestamp("2023-12-01T00:00:00Z");
    expect(result).toBeInstanceOf(Date);
  });
});

const item: MediaInfoJSON = {
  id: "abcdefghjk",
  file: "/media/test.jpg",
  platform: "Real",
  name: null,
  timestamp: "2023-12-01T00:00:00Z",
  timestamp_precision: null,
  camera: null,
  maker: null,
  tags: [],
};

describe("formatTaken", () => {
  it("says only as much as the API gives, in the photo's own date", () => {
    const at = "2023-12-16T00:00:00+09:00";
    expect(formatTaken(at, "year")).toBe("2023");
    expect(formatTaken(at, "month")).toBe("2023/12");
    expect(formatTaken("2023-12-16T00:00:00-05:00", "date")).toBe(
      "2023/12/16",
    );
    expect(formatTaken(null, "date")).toBeNull();
    expect(formatTaken("nope", "date")).toBeNull();
  });

  it("gives the full time to the second or minute", () => {
    const t = "2023-12-16T23:12:53+09:00";
    expect(formatTaken(t, "second")).toBe(new Date(t).toLocaleString("ja-JP"));
    expect(formatTaken(t, null)).toBe(new Date(t).toLocaleString("ja-JP"));
    expect(formatTaken(t, "minute")).not.toContain(":53");
  });
});

describe("transformMediaInfo", () => {
  it("should transform timestamp string to Date", () => {
    expect(transformMediaInfo(item).timestamp).toBeInstanceOf(Date);
  });

  it("should preserve null timestamp", () => {
    expect(
      transformMediaInfo({ ...item, timestamp: null }).timestamp,
    ).toBeNull();
  });

  it("should handle invalid timestamp by returning null", () => {
    expect(
      transformMediaInfo({ ...item, timestamp: "not-a-date" }).timestamp,
    ).toBeNull();
  });
});

describe("parseMediaItem", () => {
  it("accepts a photo from the API", () => {
    const camera = {
      slug: "virtuallens2",
      name: "VirtualLens2",
      manufacturer: "logilabo",
      model: "VirtualLens2",
    };
    expect(parseMediaItem({ ...item, camera, tags: ["a"] })).toEqual({
      ...item,
      camera,
      tags: ["a"],
    });
  });

  it("reads the precision and a maker-only camera", () => {
    expect(
      parseMediaItem({
        ...item,
        name: "test.jpg",
        timestamp_precision: "month",
        camera: { slug: null, name: "logilabo", manufacturer: "logilabo", model: null },
      }),
    ).toEqual({
      ...item,
      name: "test.jpg",
      timestamp_precision: "month",
      maker: "logilabo",
    });
    expect(
      parseMediaItem({ ...item, timestamp_precision: "fortnight" })
        ?.timestamp_precision,
    ).toBeNull();
  });

  it("needs platform (no old name)", () => {
    const old: Record<string, unknown> = { ...item, world: "Real" };
    delete old.platform;
    expect(parseMediaItem(old)).toBeNull();
  });

  it("accepts a photo whose file name is not public", () => {
    expect(parseMediaItem({ ...item, file: null })).toEqual({
      ...item,
      file: null,
    });
    expect(parseMediaItem({ ...item, file: undefined })).toBeNull();
  });

  it("rejects ids and files that would not be safe in a URL", () => {
    expect(parseMediaItem({ ...item, id: "../x" })).toBeNull();
    expect(parseMediaItem({ ...item, id: "abcdefghjo" })).toBeNull();
    expect(parseMediaItem({ ...item, file: "/a/../b.png" })).toBeNull();
    expect(parseMediaItem({ ...item, file: "https://x/a.png" })).toBeNull();
    expect(parseMediaItem({ ...item, platform: "Mars" })).toBeNull();
    expect(parseMediaItem(null)).toBeNull();
  });

  it("drops malformed optional fields", () => {
    expect(
      parseMediaItem({
        ...item,
        timestamp: 3,
        camera: { name: "no slug" },
        tags: ["a", 1],
      }),
    ).toEqual({
      ...item,
      timestamp: null,
      camera: null,
      maker: "no slug",
      tags: ["a"],
    });
  });
});

describe("parseMediaList", () => {
  it("keeps the valid photos of an array", () => {
    expect(parseMediaList([item, { id: 1 }])).toEqual([item]);
    expect(parseMediaList({ media: [] })).toEqual([]);
  });
});
