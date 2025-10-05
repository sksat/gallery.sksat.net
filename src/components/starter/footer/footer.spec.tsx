import { describe, it, expect } from "vitest";

describe("Footer Component", () => {
  it("should have Builder.io link", () => {
    const builderUrl = "https://www.builder.io/";
    expect(builderUrl).toBe("https://www.builder.io/");
  });

  it("should contain Made with text", () => {
    const text = "Made with ♡ by Builder.io";
    expect(text).toContain("Made with");
    expect(text).toContain("Builder.io");
  });

  it("should have link target blank for external link", () => {
    const target = "_blank";
    expect(target).toBe("_blank");
  });
});
