import { describe, it, expect } from "vitest";
import { galleryUrl, navigateImage, photoIdFromPath } from "./logic";

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
