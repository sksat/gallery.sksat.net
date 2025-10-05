import { describe, it, expect } from "vitest";

// Type definitions from gallery.tsx
type MediaWorld = "VRChat" | "Real";
type MediaCamera = {
  make: string;
  model: string;
};

type MediaInfoJSON = {
  file: string;
  world: MediaWorld;
  timestamp: null | string;
  camera: null | MediaCamera;
  tags: string[];
};

type MediaInfo = {
  file: string;
  world: MediaWorld;
  timestamp: null | Date;
  camera: null | MediaCamera;
  tags: string[];
};

// Helper function to transform MediaInfoJSON to MediaInfo
const transformMediaInfo = (item: MediaInfoJSON): MediaInfo => ({
  ...item,
  timestamp: item.timestamp ? new Date(item.timestamp) : null,
});

describe("Gallery Data Transformation", () => {
  it("should transform MediaInfoJSON timestamp string to Date", () => {
    const input: MediaInfoJSON = {
      file: "/media/test.jpg",
      world: "Real",
      timestamp: "2023-12-01T00:00:00Z",
      camera: { make: "Canon", model: "EOS R5" },
      tags: ["test"],
    };

    const result = transformMediaInfo(input);

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp?.toISOString()).toBe("2023-12-01T00:00:00.000Z");
  });

  it("should handle null timestamp", () => {
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

  it("should preserve camera information", () => {
    const input: MediaInfoJSON = {
      file: "/media/test.jpg",
      world: "Real",
      timestamp: null,
      camera: { make: "Sony", model: "A7R V" },
      tags: ["landscape"],
    };

    const result = transformMediaInfo(input);

    expect(result.camera).toEqual({ make: "Sony", model: "A7R V" });
  });

  it("should preserve tags array", () => {
    const input: MediaInfoJSON = {
      file: "/media/test.jpg",
      world: "VRChat",
      timestamp: null,
      camera: null,
      tags: ["avatar", "world", "screenshot"],
    };

    const result = transformMediaInfo(input);

    expect(result.tags).toEqual(["avatar", "world", "screenshot"]);
  });
});

describe("Gallery Filtering Logic", () => {
  it("should filter media by world type", () => {
    const media: MediaInfo[] = [
      {
        file: "/media/real1.jpg",
        world: "Real",
        timestamp: null,
        camera: null,
        tags: [],
      },
      {
        file: "/media/vrchat1.jpg",
        world: "VRChat",
        timestamp: null,
        camera: null,
        tags: [],
      },
      {
        file: "/media/real2.jpg",
        world: "Real",
        timestamp: null,
        camera: null,
        tags: [],
      },
    ];

    const selectedWorld: MediaWorld = "Real";
    const filtered = media.filter((item) => item.world === selectedWorld);

    expect(filtered).toHaveLength(2);
    expect(filtered.every((item) => item.world === "Real")).toBe(true);
  });

  it("should filter VRChat media correctly", () => {
    const media: MediaInfo[] = [
      {
        file: "/media/real1.jpg",
        world: "Real",
        timestamp: null,
        camera: null,
        tags: [],
      },
      {
        file: "/media/vrchat1.jpg",
        world: "VRChat",
        timestamp: null,
        camera: null,
        tags: [],
      },
    ];

    const selectedWorld: MediaWorld = "VRChat";
    const filtered = media.filter((item) => item.world === selectedWorld);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe("/media/vrchat1.jpg");
  });
});

describe("Gallery Navigation Logic", () => {
  it("should calculate next image index correctly", () => {
    const filteredIndices = [0, 2, 5, 7];
    const currentSelectedId = 2;
    const currentFilteredIndex = filteredIndices.indexOf(currentSelectedId);

    expect(currentFilteredIndex).toBe(1);

    const nextFilteredIndex = currentFilteredIndex + 1;
    if (nextFilteredIndex < filteredIndices.length) {
      const nextImageId = filteredIndices[nextFilteredIndex];
      expect(nextImageId).toBe(5);
    }
  });

  it("should calculate previous image index correctly", () => {
    const filteredIndices = [0, 2, 5, 7];
    const currentSelectedId = 5;
    const currentFilteredIndex = filteredIndices.indexOf(currentSelectedId);

    expect(currentFilteredIndex).toBe(2);

    const prevFilteredIndex = currentFilteredIndex - 1;
    if (prevFilteredIndex >= 0) {
      const prevImageId = filteredIndices[prevFilteredIndex];
      expect(prevImageId).toBe(2);
    }
  });

  it("should not navigate beyond last image", () => {
    const filteredIndices = [0, 2, 5, 7];
    const currentSelectedId = 7; // last image
    const currentFilteredIndex = filteredIndices.indexOf(currentSelectedId);

    const nextFilteredIndex = currentFilteredIndex + 1;
    expect(nextFilteredIndex < filteredIndices.length).toBe(false);
  });

  it("should not navigate before first image", () => {
    const filteredIndices = [0, 2, 5, 7];
    const currentSelectedId = 0; // first image
    const currentFilteredIndex = filteredIndices.indexOf(currentSelectedId);

    const prevFilteredIndex = currentFilteredIndex - 1;
    expect(prevFilteredIndex >= 0).toBe(false);
  });
});
