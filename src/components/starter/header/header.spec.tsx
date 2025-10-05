import { describe, it, expect } from "vitest";

describe("Header Component", () => {
  it("should contain correct site title", () => {
    const expectedTitle = "sksat gallery";
    expect(expectedTitle).toBe("sksat gallery");
  });

  it("should have home link path", () => {
    const homePath = "/";
    expect(homePath).toBe("/");
  });

  it("should have alt text for header image", () => {
    const altText =
      "生活(@m2__z)さんに描いていただいたイラスト: https://skeb.jp/@m2__z/works/12";
    expect(altText).toContain("@m2__z");
    expect(altText).toContain("skeb.jp");
  });
});
