import { describe, it, expect } from "vitest";
import {
  galleryUrl,
  navigateImage,
  photoIdFromPath,
  visibleMedia,
} from "./logic";
import type { MediaInfo } from "./types";

describe("navigateImage", () => {
  const filteredIndices = [0, 3, 7];

  it("should navigate to next image", () => {
    expect(navigateImage(0, filteredIndices, "next")).toBe(3);
    expect(navigateImage(3, filteredIndices, "next")).toBe(7);
  });

  it("should return null at the end boundary (next)", () => {
    expect(navigateImage(7, filteredIndices, "next")).toBeNull();
  });

  it("should navigate to previous image", () => {
    expect(navigateImage(7, filteredIndices, "prev")).toBe(3);
    expect(navigateImage(3, filteredIndices, "prev")).toBe(0);
  });

  it("should return null at the start boundary (prev)", () => {
    expect(navigateImage(0, filteredIndices, "prev")).toBeNull();
  });

  it("should return null when currentId is not in filteredIndices", () => {
    expect(navigateImage(5, filteredIndices, "next")).toBeNull();
    expect(navigateImage(5, filteredIndices, "prev")).toBeNull();
  });

  it("should return null for empty filteredIndices", () => {
    expect(navigateImage(0, [], "next")).toBeNull();
    expect(navigateImage(0, [], "prev")).toBeNull();
  });

  it("should return null in both directions for single element", () => {
    expect(navigateImage(5, [5], "next")).toBeNull();
    expect(navigateImage(5, [5], "prev")).toBeNull();
  });
});

describe("galleryUrl", () => {
  const none = { tags: [], mode: "and" as const };

  it("returns / with no photo and no filter", () => {
    expect(galleryUrl(null, none)).toBe("/");
  });

  it("returns /photo/{id} for a selected photo", () => {
    expect(galleryUrl(3, none)).toBe("/photo/3");
  });

  it("keeps the tag filter in the query", () => {
    const filter = { tags: ["VRChat", "film"], mode: "or" as const };
    expect(galleryUrl(null, filter)).toBe("/?tag=VRChat&tag=film&mode=or");
    expect(galleryUrl(2, filter)).toBe("/photo/2?tag=VRChat&tag=film&mode=or");
  });

  it("encodes tags", () => {
    expect(galleryUrl(null, { tags: ["夜 景&"], mode: "and" })).toBe(
      "/?tag=%E5%A4%9C+%E6%99%AF%26",
    );
  });

  it("appends a non-default sort order after the filter", () => {
    expect(galleryUrl(null, none, { kind: "old", seed: 0 })).toBe("/?sort=old");
    expect(
      galleryUrl(
        1,
        { tags: ["VRChat"], mode: "and" },
        { kind: "random", seed: 7 },
      ),
    ).toBe("/photo/1?tag=VRChat&sort=random&seed=7");
    expect(galleryUrl(null, none, { kind: "new", seed: 0 })).toBe("/");
  });

  it("returns to the camera page, and remembers it on a photo", () => {
    const newest = { kind: "new" as const, seed: 0 };
    expect(galleryUrl(null, none, newest, "virtuallens2")).toBe(
      "/camera/virtuallens2/",
    );
    expect(galleryUrl(1, none, newest, "virtuallens2")).toBe(
      "/photo/1?camera=virtuallens2",
    );
    const filter = { tags: ["VRChat"], mode: "and" as const };
    const oldest = { kind: "old" as const, seed: 0 };
    expect(galleryUrl(null, filter, oldest, "virtuallens2")).toBe(
      "/camera/virtuallens2/?tag=VRChat&sort=old",
    );
    expect(galleryUrl(4, filter, oldest, "virtuallens2")).toBe(
      "/photo/4?camera=virtuallens2&tag=VRChat&sort=old",
    );
  });
});

describe("visibleMedia", () => {
  const media: MediaInfo[] = [
    { file: "/0", world: "Real", timestamp: null, camera: null, tags: [] },
    {
      file: "/1",
      world: "VRChat",
      timestamp: null,
      camera: { make: "logilabo", model: "VirtualLens2", slug: "virtuallens2" },
      tags: ["night"],
    },
    {
      file: "/2",
      world: "VRChat",
      timestamp: null,
      camera: { make: "logilabo", model: "VirtualLens2" },
      tags: [],
    },
  ];
  const none = { tags: [], mode: "and" as const };

  it("shows everything without a camera", () => {
    expect(visibleMedia(media, none, null).map((m) => m.index)).toEqual([
      0, 1, 2,
    ]);
  });

  it("keeps the camera's photos with their global indices", () => {
    expect(
      visibleMedia(media, none, "virtuallens2").map((m) => m.index),
    ).toEqual([1, 2]);
  });

  it("applies the tag filter on top", () => {
    expect(
      visibleMedia(media, { tags: ["night"], mode: "and" }, "virtuallens2").map(
        (m) => m.index,
      ),
    ).toEqual([1]);
  });
});

describe("photoIdFromPath", () => {
  it("reads the id from /photo/{id} with or without trailing slash", () => {
    expect(photoIdFromPath("/photo/3")).toBe(3);
    expect(photoIdFromPath("/photo/12/")).toBe(12);
  });

  it("returns null elsewhere or for invalid ids", () => {
    expect(photoIdFromPath("/")).toBeNull();
    expect(photoIdFromPath("/photo/")).toBeNull();
    expect(photoIdFromPath("/photo/abc")).toBeNull();
    expect(photoIdFromPath("/photo/-1")).toBeNull();
    expect(photoIdFromPath("/photo/1/extra")).toBeNull();
  });
});
