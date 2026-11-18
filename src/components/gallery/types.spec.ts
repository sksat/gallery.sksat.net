import { describe, it, expect } from "vitest";
import {
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
  timestamp: "2023-12-01T00:00:00Z",
  camera: null,
  tags: [],
};

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

  it("reads the platform under its old name, world, from an older API", () => {
    const old: Record<string, unknown> = { ...item, world: "Real" };
    delete old.platform;
    expect(parseMediaItem(old)).toEqual(item);
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
    ).toEqual({ ...item, timestamp: null, camera: null, tags: ["a"] });
  });
});

describe("parseMediaList", () => {
  it("keeps the valid photos of an array", () => {
    expect(parseMediaList([item, { id: 1 }])).toEqual([item]);
    expect(parseMediaList({ media: [] })).toEqual([]);
  });
});
