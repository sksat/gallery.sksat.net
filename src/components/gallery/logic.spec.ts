import { describe, it, expect } from "vitest";
import { navigateImage } from "./logic";

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
