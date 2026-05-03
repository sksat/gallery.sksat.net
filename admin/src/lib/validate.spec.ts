import { describe, expect, it } from "vitest";
import { parseTagsInput, validatePatch } from "./validate";

describe("validatePatch", () => {
  it("accepts a partial patch with only tags", () => {
    const r = validatePatch({ tags: ["a", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch).toEqual({ tags: ["a", "b"] });
  });

  it("trims and drops empty tags", () => {
    const r = validatePatch({ tags: [" a ", "", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.tags).toEqual(["a", "b"]);
  });

  it("rejects non-string tag entries", () => {
    const r = validatePatch({ tags: ["a", 1] });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown world", () => {
    const r = validatePatch({ world: "Mars" });
    expect(r.ok).toBe(false);
  });

  it("converts empty camera string to null", () => {
    const r = validatePatch({ camera_make: "", camera_model: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.camera_make).toBeNull();
      expect(r.patch.camera_model).toBeNull();
    }
  });

  it("rejects array body", () => {
    const r = validatePatch([]);
    expect(r.ok).toBe(false);
  });
});

describe("parseTagsInput", () => {
  it("splits on commas and trims", () => {
    expect(parseTagsInput("a, b ,c")).toEqual(["a", "b", "c"]);
  });
  it("drops empties", () => {
    expect(parseTagsInput(",,a,,")).toEqual(["a"]);
  });
});
