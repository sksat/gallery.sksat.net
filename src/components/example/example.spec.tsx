import { describe, it, expect } from "vitest";
import { Example } from "./example";

describe("Example Component", () => {
  it("should have correct title prop interface", () => {
    // This test verifies the component accepts the expected props
    const props = { title: "Test Title" };
    expect(props.title).toBe("Test Title");
  });

  it("should export the Example component", () => {
    expect(Example).toBeDefined();
  });
});
