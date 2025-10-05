import { describe, it, expect } from "vitest";
import { parseMediaTimestamp, transformMediaInfo } from "./types";
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

describe("transformMediaInfo", () => {
  it("should transform timestamp string to Date", () => {
    const input: MediaInfoJSON = {
      file: "/media/test.jpg",
      world: "Real",
      timestamp: "2023-12-01T00:00:00Z",
      camera: null,
      tags: [],
    };

    const result = transformMediaInfo(input);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("should preserve null timestamp", () => {
    const input: MediaInfoJSON = {
      file: "/media/test.jpg",
      world: "VRChat",
      timestamp: null,
      camera: null,
      tags: [],
    };

    const result = transformMediaInfo(input);
    expect(result.timestamp).toBeNull();
  });

  it("should handle invalid timestamp by returning null", () => {
    const input: MediaInfoJSON = {
      file: "/media/test.jpg",
      world: "Real",
      timestamp: "not-a-date",
      camera: null,
      tags: [],
    };

    const result = transformMediaInfo(input);
    expect(result.timestamp).toBeNull();
  });
});
